#!/usr/bin/env node
// Real MCP workflow (SYNTHETIC ONLY). Requires `npm run build` and a local SPARQ policy binary.
//
// Independently initialised agents run as SEPARATE OS processes, each an `awp-pilot mcp`
// server on stdio (official @modelcontextprotocol/sdk). This harness is an MCP client (the same
// SDK) connected to every server. It discovers tools and profiles, starts a scheduling
// negotiation and shuttles the SIGNED logical messages between the servers over MCP until both
// sides complete — no LLM, no text generation: every step is a tool call with a signed
// envelope produced by the other agent. One hop crosses into the email MIME binding (carried
// over MCP) within the same conversation. Carriage is local and synthetic: not Gmail, not a
// provider, and not independent-vendor interoperability (every agent runs this code).
//
// Usage: node scripts/pilot-mcp-integration.mjs --sparq-bin=PATH [--out reports/pilot-mcp-report.json]
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(root, "dist", "pilot", "cli.js");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "pilot-mcp-report.json");
const SPARQ_BIN = flag("sparq-bin") ?? process.env.AWP_SPARQ_POLICY_BIN;
const NOW = "2026-10-19T08:00:00Z"; // fixed synthetic clock; the meeting window is 2026-10-20
if (!existsSync(CLI)) {
  console.error("build first: npm run build");
  process.exit(2);
}
if (!SPARQ_BIN || !existsSync(SPARQ_BIN)) {
  console.error(
    "setup-required: pass --sparq-bin=PATH (or AWP_SPARQ_POLICY_BIN) to a built sparq-policy-decide",
  );
  process.exit(3);
}
const work = mkdtempSync(join(tmpdir(), "awp-mcp-"));
const dir = join(work, "agents");
const checks = [];
const steps = [];
const diagnostics = {};
const clients = new Map();

function check(id, claim, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ id, claim, expected, actual, pass });
  if (!pass)
    console.error(
      `FAIL ${id}: ${claim}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
}

/** One CLI command as its own OS process (setup and post-shutdown inspection only). */
function cli(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args, "--dir", dir, "--now", NOW], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      steps.push({ process: `cli ${args[0]}`, pid: child.pid, exitCode: code });
      let json = {};
      try {
        json = JSON.parse(stdout);
      } catch {}
      done({ code, stdout, stderr, json });
    });
  });
}

/** Start `awp-pilot mcp` for one agent and connect the official SDK client over stdio. */
async function connect(name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp", "--name", name, "--dir", dir, "--now", NOW],
    stderr: "pipe",
  });
  diagnostics[name] = diagnostics[name] ?? [];
  transport.stderr?.on("data", (d) => diagnostics[name].push(...String(d).trim().split("\n")));
  const client = new Client({ name: "awp-mcp-integration", version: "0.1.0" });
  await client.connect(transport);
  steps.push({ process: `mcp server ${name}`, pid: transport.pid, event: "connected" });
  const entry = { client, transport, pid: transport.pid };
  clients.set(name, entry);
  return entry;
}

async function disconnect(name) {
  const entry = clients.get(name);
  if (!entry) return;
  clients.delete(name);
  await entry.client.close(); // closes stdin: the server finishes, releases its lock and exits
  steps.push({ process: `mcp server ${name}`, pid: entry.pid, event: "closed" });
}

async function call(name, tool, args = {}) {
  const r = await clients.get(name).client.callTool({ name: tool, arguments: args });
  steps.push({ tool: `${name}.${tool}`, isError: Boolean(r.isError) });
  if (r.isError) return { error: r.content?.[0]?.text ?? "error" };
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Shuttle every pending outbound message of `names` to its addressee's server until quiet.
 * `viaEmail(item)` chooses the email MIME binding (carried over MCP) for particular hops.
 */
const carried = []; // every envelope the harness carried, in order (for replay/tamper tests)
async function shuttle(names, byActor, trace, viaEmail = () => false) {
  for (let round = 0; round < 20; round++) {
    let moved = 0;
    for (const from of names) {
      const { outbound = [] } = await call(from, "list_outbound");
      for (const item of outbound) {
        const to = byActor[item.toActor];
        if (!to || !clients.has(to)) continue;
        const email = viaEmail(item) && item.email;
        carried.push({ kind: item.kind, from, to, envelope: item.envelope });
        const r = await call(
          to,
          "deliver_inbound",
          email
            ? {
                format: "gmail-json",
                data: JSON.stringify({
                  id: `m${trace.length + 1}`,
                  threadId: "18c0ffee00000001",
                  raw: item.email.gmailSend.raw,
                }),
              }
            : { format: "envelope", data: JSON.stringify(item.envelope) },
        );
        trace.push({
          from,
          to,
          kind: item.kind,
          binding: r.input?.binding,
          ...(r.input?.carrier ? { carrier: r.input.carrier } : {}),
          disposition: r.step?.disposition ?? r.input?.bindingOutcome ?? r.error,
          ...(r.step?.reason ? { reason: r.step.reason } : {}),
          decisions: (r.step?.decisions ?? []).map((d) => d.outcome),
        });
        await call(from, "ack_outbound", { ids: [item.id] });
        moved++;
      }
    }
    if (moved === 0) return;
  }
}

const TOOLS = [
  "ack_outbound",
  "deliver_inbound",
  "get_evidence",
  "get_profile",
  "get_status",
  "list_outbound",
  "propose_meeting", // the personal role's declared operation
  "submit_approval", // accepts only an approval signed with the OWNER key outside the server
];

let fatal;
const saved = {};
try {
  // ---- setup: independent agents, each initialised and pinned by separate CLI processes ----
  const agents = {
    alice: {
      party: "https://alice.example/#me",
      actor: "https://agents.alice.example/personal#agent",
      email: "alice.awp@example.com",
      tz: "Europe/London",
    },
    bob: {
      party: "https://bob.example/#me",
      actor: "https://agents.hostco.example/bob#agent",
      email: "bob.awp@example.com",
      tz: "America/New_York",
    },
    carol: {
      party: "https://carol.example/#me",
      actor: "https://agents.carol.example/personal#agent",
      tz: "UTC",
    },
    dave: {
      party: "https://dave.example/#me",
      actor: "https://agents.dave.example/personal#agent",
      tz: "UTC",
    },
  };
  const byActor = Object.fromEntries(Object.entries(agents).map(([n, a]) => [a.actor, n]));
  const daveBin = join(work, "sparq-policy-decide-dave"); // a private copy dave pins
  copyFileSync(SPARQ_BIN, daveBin);
  const known = { alice: ["bob", "dave"], bob: ["alice"], carol: ["alice"], dave: ["alice"] };
  const cards = {};
  for (const [name, a] of Object.entries(agents)) {
    const r = await cli([
      "init",
      "--policy-engine=sparq",
      `--sparq-bin=${name === "dave" ? daveBin : resolve(SPARQ_BIN)}`,
      "--name",
      name,
      "--party",
      a.party,
      "--actor",
      a.actor,
      "--timezone",
      a.tz,
      ...(a.email ? ["--email", a.email] : []),
      ...known[name].flatMap((k) => ["--known-party", agents[k].party]),
    ]);
    cards[name] = { ...r.json };
    const c = await cli(["card", "--name", name]);
    writeFileSync(join(work, `${name}.card.json`), c.stdout);
  }
  const pins = { alice: ["bob", "dave"], bob: ["alice"], carol: ["alice"], dave: ["alice"] };
  for (const [who, peers] of Object.entries(pins))
    for (const p of peers)
      await cli([
        "pin",
        "--name",
        who,
        "--card",
        join(work, `${p}.card.json`),
        `--party-kid=${cards[p].partyKid}`,
        `--actor-kid=${cards[p].actorKid}`,
      ]);

  // ---- servers + discovery ----
  for (const name of Object.keys(agents)) await connect(name);
  const tools = (await clients.get("alice").client.listTools()).tools.map((t) => t.name).sort();
  check(
    "M.1",
    "the MCP server advertises exactly the operator/binding tools (no shell, keys, pinning, approval without an owner signature, or sending)",
    tools,
    TOOLS,
  );
  const profile = await call("alice", "get_profile");
  check(
    "M.2",
    "the profile advertises the MCP binding and the selected policy module (SPARQ, ready) separately from the policy profile; no local path",
    [
      profile.description.bindings.map((b) => b.id),
      profile.description.policyModule.evaluator.name,
      profile.description.policyModule.status,
      /policy-profile\/odrl-pilot-subset\/0\.1$/.test(
        profile.description.policyModule.policyProfile,
      ),
      JSON.stringify(profile.description).includes(work),
    ],
    [["direct-local/0.1", "email-mime/0.1", "mcp-tool/0.1"], "sparq-policy", "ready", true, false],
  );
  const locked = await cli(["status", "--name", "alice"]);
  check(
    "M.3",
    "while the MCP server owns alice, a competing CLI runtime is refused (single writer)",
    [locked.code, /state is locked/.test(locked.stderr)],
    [1, true],
  );

  // ---- scheduling over MCP, one hop in the email MIME binding ----
  const proposed = await call("alice", "propose_meeting", {
    peerActor: agents.bob.actor,
    windowStart: "2026-10-20T13:00:00Z",
    windowEnd: "2026-10-20T17:00:00Z",
    durationMinutes: 30,
    title: "Synthetic MCP catch-up",
  });
  const trace = [];
  await shuttle(["alice", "bob"], byActor, trace, (item) => item.kind === "description");
  saved.firstPropose = carried.find((c) => c.kind === "propose" && c.from === "alice")?.envelope;
  check(
    "M.4",
    "the negotiation completes over MCP: discovery, offer, acceptance, two receipts (signed messages only, no text generation)",
    // Bob emits his accept and receipt together, so the two receipts' order is not fixed.
    [
      trace.slice(0, 4).map((t) => `${t.from}>${t.kind}:${t.disposition}`),
      trace
        .slice(4)
        .map((t) => `${t.from}>${t.kind}:${t.disposition}`)
        .sort(),
    ],
    [
      [
        "alice>describe:accepted",
        "bob>description:accepted",
        "alice>propose:accepted",
        "bob>accept:accepted",
      ],
      ["alice>receipt:accepted", "bob>receipt:accepted"],
    ],
  );
  check(
    "M.5",
    "mixed bindings in ONE conversation: envelopes over mcp-tool/0.1, the description hop in email-mime/0.1 carried over MCP",
    trace.map((t) => `${t.kind}:${t.binding}${t.carrier ? `+${t.carrier}` : ""}`),
    [
      "describe:mcp-tool/0.1",
      "description:email-mime/0.1+mcp-tool/0.1",
      "propose:mcp-tool/0.1",
      "accept:mcp-tool/0.1",
      "receipt:mcp-tool/0.1",
      "receipt:mcp-tool/0.1",
    ],
  );
  const sa = await call("alice", "get_status");
  const sb = await call("bob", "get_status");
  check(
    "M.6",
    "both completed with exactly one synthetic calendar hold each",
    [
      sa.conversations.map((c) => c.phase),
      sb.conversations.map((c) => c.phase),
      Object.keys(sa.holds).length,
      Object.keys(sb.holds).length,
    ],
    [["completed"], ["completed"], 1, 1],
  );
  const ea = await call("alice", "get_evidence", { type: "authorisation-decision", limit: 50 });
  const eb = await call("bob", "get_evidence", { type: "authorisation-decision", limit: 50 });
  const decisions = [...ea.records, ...eb.records].map((r) => r.record);
  check(
    "M.7",
    "every authorisation decision was made by the recorded SPARQ module and permitted the scheduling actions; ledgers verify",
    [
      decisions.length > 0,
      decisions.every((d) => String(d.policy?.evaluator).startsWith("sparq-policy@")),
      decisions.every((d) => d.outcome === "permit"),
      ea.verification.ok && eb.verification.ok,
    ],
    [true, true, true, true],
  );
  void proposed;

  // ---- replay, tampering, wrong audience, oversized ----
  const replay = await call("bob", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(saved.firstPropose),
  });
  const sb2 = await call("bob", "get_status");
  check(
    "M.8",
    "replaying the first proposal is a duplicate; still one hold",
    [replay.step?.disposition, Object.keys(sb2.holds).length],
    ["duplicate", 1],
  );
  const [h, p, s] = saved.firstPropose.jws.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  payload.id = `${payload.id}-tampered`;
  const tampered = {
    ...saved.firstPropose,
    jws: `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`,
  };
  const t = await call("bob", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(tampered),
  });
  const wrong = await call("carol", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(saved.firstPropose),
  });
  const big = await call("bob", "deliver_inbound", {
    format: "envelope",
    data: "x".repeat(300 * 1024),
  });
  const sc = await call("carol", "get_status");
  const sb3 = await call("bob", "get_status");
  check(
    "M.9",
    "tampered → bad-signature; wrong audience (carol pins alice) → wrong-audience; oversized → refused before the runtime; no effect anywhere",
    [
      t.step?.disposition,
      t.step?.reason,
      wrong.step?.disposition,
      wrong.step?.reason,
      Boolean(big.error) && /256|too_big|too big|max/i.test(big.error),
      sc.conversations.length,
      Object.keys(sc.holds).length,
      Object.keys(sb3.holds).length,
    ],
    ["rejected", "bad-signature", "rejected", "wrong-audience", true, 0, 0, 1],
  );

  // ---- policy module changed while the server runs (same process, no reopen) ----
  const d0 = await call("dave", "get_status");
  writeFileSync(daveBin, `${readFileSync(daveBin).subarray(0, 64).toString("latin1")}replaced`);
  const d1 = await call("dave", "get_status");
  const daveTrace = [];
  await call("dave", "propose_meeting", {
    peerActor: agents.alice.actor,
    windowStart: "2026-10-20T13:00:00Z",
    windowEnd: "2026-10-20T17:00:00Z",
  });
  await shuttle(["dave", "alice"], byActor, daveTrace);
  const d2 = await call("dave", "get_status");
  const de = await call("dave", "get_evidence", { type: "authorisation-decision", limit: 10 });
  check(
    "M.10",
    "dave's running server detects its replaced SPARQ binary: status unavailable, the proposal decision is indeterminate, no propose is sent",
    [
      d0.policyModule.status,
      d1.policyModule.status,
      /changed since it was probed/.test(d1.policyModule.reason ?? ""),
      daveTrace.map((x) => `${x.from}>${x.kind}:${x.disposition}`),
      de.records.map((r) => r.record.outcome),
      /policy module unavailable/.test(JSON.stringify(de.records)),
      d2.conversations.map(
        (c) => `${c.phase}:${/policy module unavailable/.test(String(c.closedReason))}`,
      ),
      JSON.stringify(d2).includes(daveBin),
    ],
    [
      "ready",
      "unavailable",
      true,
      ["dave>describe:accepted", "alice>description:accepted"],
      ["indeterminate"],
      true,
      ["refused:true"],
      false,
    ],
  );

  // ---- graceful shutdown, lock release, restart ----
  const bobPid = clients.get("bob").pid;
  await disconnect("bob");
  const afterStop = await cli(["status", "--name", "bob"]);
  check(
    "M.11",
    "closing bob's MCP client stops the server gracefully: process gone, lock released, state saved (a CLI process can open it)",
    [
      alive(bobPid),
      diagnostics.bob.some((l) => /stopped; state saved and lock released/.test(l)),
      afterStop.code,
      afterStop.json.conversations?.map((c) => c.phase),
      Object.keys(afterStop.json.holds ?? {}).length,
    ],
    [false, true, 0, ["completed"], 1],
  );
  await connect("bob");
  const restartedStatus = await call("bob", "get_status");
  const replay2 = await call("bob", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(saved.firstPropose),
  });
  check(
    "M.12",
    "after restart the conversation, hold and replay protection persist",
    [
      restartedStatus.conversations.map((c) => c.phase),
      Object.keys(restartedStatus.holds).length,
      replay2.step?.disposition,
    ],
    [["completed"], 1, "duplicate"],
  );
  check(
    "M.13",
    "stdout carried only MCP messages (every server connected and answered); diagnostics went to stderr",
    Object.values(diagnostics).every((lines) => lines.some((l) => /ready: actor/.test(l))),
    true,
  );
} catch (error) {
  fatal = String(error?.stack ?? error);
  console.error(fatal);
} finally {
  for (const name of [...clients.keys()]) await disconnect(name).catch(() => undefined);
}

const report = {
  report: "Agentic Web pilot — MCP workflow (official SDK, stdio, separate OS processes)",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    clock: `fixed synthetic ${NOW}; meeting window 2026-10-20 (synthetic holds only)`,
    policyModule:
      "sparq (recorded and probed at init; dave pins a private copy that is replaced mid-run)",
    boundary:
      "each agent is an `awp-pilot mcp` stdio server in its own OS process; this harness is one official-SDK MCP client per server and shuttles the agents' own signed messages between them. Carriage is LOCAL and SYNTHETIC: not Gmail, not a provider, not independent-vendor interoperability (every agent runs this code); no network listener",
  },
  checks,
  steps: steps.slice(0, 400),
  diagnostics,
  ...(fatal ? { fatal } : {}),
  summary: {
    checks: checks.length,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length + (fatal ? 1 : 0),
    serverProcesses: steps.filter((s) => s.event === "connected").length,
    cliProcesses: steps.filter((s) => String(s.process).startsWith("cli")).length,
  },
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify({ written: OUT, summary: report.summary }));
process.exit(report.summary.failed === 0 ? 0 : 1);
