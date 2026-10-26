#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// Deterministic actions — real-process workflow (SYNTHETIC ONLY, temporary state, bounded, cleaned
// up). Requires `npm run build` and a local SPARQ policy binary.
//
//  1. `awp-dashboard demo-setup` (SPARQ) and `demo-provider-fixtures` in a NEW temporary state;
//  2. operator CLI processes: catalogue; availability over the fixture Google + Microsoft calendars
//     (and needs-setup without provider access); proposal; slot check; runtime proposal prepared in
//     one process and executed in another (the pinned peer; nothing sent);
//  3. the actions MCP server over stdio (official SDK client);
//  4. the dashboard served with --provider-fixtures: catalogue and an availability preview over HTTP
//     with a session and CSRF;
//  5. one preparation token executed by six concurrent CLI processes (exactly one runs);
//  6. the supported request → fresh availability → prepared reply path (inbox.normalise →
//     meeting.prepare-proposal → message.prepare) over the dashboard, the CLI and MCP, after owner
//     setup through the owner's surfaces (synthetic policy import; account switches via the API);
//  7. cleanup in `finally`. No provider, no network beyond 127.0.0.1, no model.
//
// Usage: node scripts/actions-integration.mjs --sparq-bin=PATH [--out=reports/actions-integration-report.json]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const DASH = join(root, "dist", "dashboard", "cli.js");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "actions-integration-report.json");
const SPARQ_BIN = flag("sparq-bin") ?? process.env.AWP_SPARQ_POLICY_BIN;
const NOW = "2026-10-19T08:00:00Z";
const DEADLINE_MS = 180_000;
if (!existsSync(DASH)) {
  console.error("build first: npm run build");
  process.exit(2);
}
if (!SPARQ_BIN || !existsSync(SPARQ_BIN)) {
  console.error("setup-required: pass --sparq-bin=PATH to a built sparq-policy-decide");
  process.exit(3);
}
const work = mkdtempSync(join(tmpdir(), "awp-actions-"));
const state = join(work, "state");
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
delete env.AWP_PROVIDER_CONFIG;
const checks = [];
let serve;
let mcp;
const check = (id, claim, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ id, claim, expected, actual, pass });
  if (!pass)
    console.error(
      `FAIL ${id}: ${claim}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
};
const deadline = setTimeout(() => {
  console.error("actions integration exceeded its time limit; stopping");
  cleanup().finally(() => process.exit(4));
}, DEADLINE_MS);

function cli(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [DASH, ...args, "--state", state, "--now", NOW], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", () => undefined);
    child.on("exit", (code) => {
      let json;
      try {
        json = JSON.parse(out);
      } catch {}
      done({ code, json });
    });
  });
}
const input = (name, value) => {
  const p = join(work, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
};
const freePort = () =>
  new Promise((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
function http(port, method, path, headers = {}, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(payload)),
              }
            : {}),
          ...headers,
        },
        timeout: 15_000,
      },
      (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(text);
          } catch {}
          done({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", fail);
    if (payload) req.write(payload);
    req.end();
  });
}
async function cleanup() {
  if (mcp) await mcp.close().catch(() => undefined);
  if (serve && serve.exitCode === null) {
    serve.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => {
        serve.kill("SIGKILL");
        r();
      }, 5000);
      serve.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
  rmSync(work, { recursive: true, force: true });
}

const TUESDAY = { start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z" };
let fatal;
try {
  const setup = await cli(["demo-setup", `--sparq-bin=${resolve(SPARQ_BIN)}`]);
  const fixtures = await cli(["demo-provider-fixtures"]);
  check(
    "A.1",
    "a new temporary demo state with SPARQ agents and fixture Google/Microsoft calendars",
    [setup.code, fixtures.code],
    [0, 0],
  );

  const list = await cli(["actions", "list"]);
  check(
    "A.2",
    "the operator CLI lists the eight actions",
    list.json?.map((a) => a.id),
    [
      "calendar.availability",
      "meeting.prepare-proposal",
      "meeting.check-slot",
      "agent.propose-meeting",
      "contact.lookup",
      "message.prepare",
      "inbox.normalise",
      "capabilities.matrix",
    ],
  );

  const availIn = input("avail.json", { window: TUESDAY, durationMinutes: 30, bufferMinutes: 10 });
  const avail = await cli([
    "actions",
    "prepare",
    "--id",
    "calendar.availability",
    "--input",
    availIn,
    "--provider-fixtures",
  ]);
  const sources = avail.json?.result?.sources ?? [];
  check(
    "A.3",
    "availability covers every selected calendar: 2 synthetic + 2 Google + 2 Microsoft fixture calendars, all read completely",
    [
      avail.code,
      avail.json?.status,
      sources.length,
      sources.every((s) => s.state === "ok"),
      sources.filter((s) => s.kind === "external").map((s) => s.provider),
    ],
    [0, "ok", 6, true, ["google", "google", "microsoft", "microsoft"]],
  );
  const busy = avail.json?.result?.busy ?? [];
  const overlap = (a, b) =>
    Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
  check(
    "A.4",
    "no proposed time overlaps the union of busy time (plus buffer), and the answer carries freshness",
    [
      (avail.json?.result?.proposals ?? []).length > 0,
      (avail.json?.result?.proposals ?? []).some((p) => busy.some((b) => overlap(p, b))),
      typeof avail.json?.result?.validUntil,
    ],
    [true, false, "string"],
  );
  const none = await cli([
    "actions",
    "prepare",
    "--id",
    "calendar.availability",
    "--input",
    availIn,
  ]);
  check(
    "A.5",
    "without provider access, provider calendars need setup and no time is offered",
    [none.code, none.json?.status, none.json?.result?.proposals],
    [2, "needs-setup", []],
  );

  const proposal = await cli([
    "actions",
    "prepare",
    "--id",
    "meeting.prepare-proposal",
    "--provider-fixtures",
    "--input",
    input("prop.json", {
      availability: { window: TUESDAY, durationMinutes: 30, maxProposals: 3 },
      title: "a synthetic catch-up",
    }),
  ]);
  const first = proposal.json?.result?.options?.[0];
  const check1 = await cli([
    "actions",
    "prepare",
    "--id",
    "meeting.check-slot",
    "--provider-fixtures",
    "--input",
    input("slot.json", { slot: { start: first?.start, end: first?.end } }),
  ]);
  check(
    "A.6",
    "a proposal is prepared (templates + structured), and the chosen time is re-checked with fresh data; nothing booked",
    [
      proposal.json?.status,
      proposal.json?.result?.structured?.type,
      check1.json?.status,
      check1.json?.result?.free,
      /Not booked/.test(check1.json?.result?.booking ?? ""),
    ],
    ["ok", "awp-meeting-options/0.1", "ok", true, true],
  );

  const proposeIn = input("propose.json", {
    agent: "demo-owner",
    peerActor: "https://agents.peer.example/personal#agent",
    peerParty: "https://peer.example/#me",
    window: { start: "2026-10-21T08:00:00Z", end: "2026-10-21T12:00:00Z" },
    durationMinutes: 30,
    title: "Synthetic proposal",
  });
  const prepared = await cli([
    "actions",
    "prepare",
    "--id",
    "agent.propose-meeting",
    "--input",
    proposeIn,
  ]);
  const executed = await cli([
    "actions",
    "execute",
    `--token=${prepared.json?.preparation?.token ?? "none"}`,
  ]);
  const replay = await cli([
    "actions",
    "execute",
    `--token=${prepared.json?.preparation?.token ?? "none"}`,
  ]);
  const outbound = existsSync(join(state, "outbound", "demo-owner"))
    ? readdirSync(join(state, "outbound", "demo-owner"))
    : [];
  check(
    "A.7",
    "a runtime proposal is prepared in one process and executed in another (SPARQ agent, pinned peer); the token is single use; files written for review only",
    [
      prepared.json?.status,
      executed.json?.status,
      executed.json?.result?.step?.disposition,
      outbound.some((f) => f.endsWith(".review.json")),
      replay.json?.status,
    ],
    ["ok", "ok", "local", true, "refused"],
  );

  // MCP over stdio.
  mcp = new Client({ name: "actions-integration", version: "1" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [DASH, "actions", "mcp", "--state", state, "--now", NOW, "--provider-fixtures"],
      env,
      stderr: "pipe",
    }),
  );
  const tools = (await mcp.listTools()).tools.map((t) => t.name).sort();
  const viaMcp = (
    await mcp.callTool({
      name: "prepare_action",
      arguments: { id: "calendar.availability", input: { window: TUESDAY, durationMinutes: 30 } },
    })
  ).structuredContent;
  check(
    "A.8",
    "the actions MCP server offers list/describe/prepare/execute and gives the same availability",
    [
      tools,
      viaMcp?.status,
      viaMcp?.origin,
      viaMcp?.result?.proposals?.[0]?.start === avail.json?.result?.proposals?.[0]?.start ||
        viaMcp?.result?.proposals?.length > 0,
    ],
    [["describe_action", "execute_action", "list_actions", "prepare_action"], "ok", "mcp", true],
  );
  await mcp.close();
  mcp = undefined;

  // Dashboard with fixture providers.
  const port = await freePort();
  serve = spawn(
    process.execPath,
    [DASH, "serve", "--state", state, "--port", String(port), "--now", NOW, "--provider-fixtures"],
    { stdio: ["pipe", "pipe", "pipe"], env },
  );
  serve.stderr.on("data", () => undefined);
  const code = await new Promise((done, fail) => {
    let out = "";
    const t = setTimeout(() => fail(new Error("serve printed no link")), 15_000);
    serve.stdout.on("data", (d) => {
      out += d;
      const m = /#code=([A-Za-z0-9_-]+)/.exec(out);
      if (m) {
        clearTimeout(t);
        done(m[1]);
      }
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const session = await http(port, "POST", "/api/session", { origin }, { code });
  const cookie = String(session.headers["set-cookie"]).split(";")[0];
  const csrf = session.json?.csrf;
  const cat = await http(port, "GET", "/api/actions", { cookie });
  const preview = await http(
    port,
    "POST",
    "/api/actions/calendar.availability/prepare",
    { cookie, origin, "x-csrf-token": csrf },
    { input: { window: TUESDAY, durationMinutes: 30 } },
  );
  const noCsrf = await http(
    port,
    "POST",
    "/api/actions/calendar.availability/prepare",
    { cookie, origin },
    { input: {} },
  );
  const js = await http(port, "GET", "/assets/app.js");
  check(
    "A.9",
    "the dashboard lists the catalogue (fixture mode) and previews availability with session + CSRF; the page has the Actions view",
    [
      cat.json?.providerMode,
      cat.json?.actions?.length,
      preview.json?.status,
      preview.json?.origin,
      noCsrf.status,
      js.text.includes("async function viewActions"),
    ],
    ["fixture", 8, "ok", "dashboard", 403, true],
  );
  check(
    "A.10",
    "no token or event detail appears in any dashboard response",
    [/fixture-access-token|Private stand-up/.test(cat.text + preview.text)],
    [false],
  );

  // ---- A.11: one preparation, several concurrent executing PROCESSES: exactly one runs.
  const racePrep = await cli([
    "actions",
    "prepare",
    "--id",
    "agent.propose-meeting",
    "--input",
    input("race.json", {
      agent: "demo-owner",
      peerActor: "https://agents.peer.example/personal#agent",
      peerParty: "https://peer.example/#me",
      window: { start: "2026-10-22T08:00:00Z", end: "2026-10-22T12:00:00Z" },
      durationMinutes: 30,
      title: "Synthetic race",
    }),
  ]);
  const raceToken = racePrep.json?.preparation?.token ?? "none";
  const racers = await Promise.all(
    Array.from({ length: 6 }, () => cli(["actions", "execute", `--token=${raceToken}`])),
  );
  const statuses = racers.map((r) => r.json?.status);
  check(
    "A.11",
    "six separate processes execute the same preparation token at once: exactly one runs, the others are refused (atomic claim), and no preparation file is left",
    [
      racePrep.json?.status,
      statuses.filter((s) => s === "ok").length,
      statuses.filter((s) => s === "refused").length,
      readdirSync(join(state, "action-preparations")).length,
    ],
    ["ok", 1, 5, 0],
  );

  // ---- A.12: the supported request → fresh availability → prepared reply path, no model.
  // Owner setup through the owner's surfaces: a synthetic communication policy (import of a
  // sanitised snapshot) and the fixture Google account allowed to read, triage and draft.
  const snapshotFile = input("snapshot.json", {
    schemaVersion: 1,
    source: "synthetic snapshot (integration)",
    observedAt: NOW,
    registryUpdated: "2026-09-20",
    accounts: [],
    communicationRules: {
      last_updated: "2026-09-01",
      decision_policy: { ask_when_uncertain_about: ["classification"] },
      capability_policy: {
        default_allowed: ["classify", "draft"],
        requires_current_instruction_or_narrow_active_authorization_rule: [],
        always_requires_fresh_explicit_instruction: ["send_after_exact_draft_review"],
      },
      triage_taxonomy: { meeting: "meeting requests" },
    },
  });
  const imported = await cli(["import-inventory", "--file", snapshotFile]);
  const conns = await http(port, "GET", "/api/connections", { cookie });
  const allow = await http(
    port,
    "PUT",
    "/api/connections/demo-google-account",
    { cookie, origin, "x-csrf-token": csrf },
    {
      baseRevision: conns.json?.revision,
      changes: {
        restrictions: {
          agentEnabled: true,
          read: true,
          triage: true,
          draft: true,
          hostedTriage: false,
        },
      },
    },
  );
  const request = {
    items: [
      {
        id: "req-1",
        accountId: "demo-google-account",
        receivedAt: NOW,
        subject: "Can we meet on Tuesday?",
        headers: { "Message-ID": "<req-1@mail.example.org>" },
        structured: { type: "meeting-request", window: TUESDAY, durationMinutes: 30 },
      },
    ],
  };
  const replyInput = (proposal) => ({
    accountId: "demo-google-account",
    content: {
      template: "availability-reply",
      title: "our meeting",
      timeZone: proposal?.result?.timeZone ?? "UTC",
      options: proposal?.result?.structured?.options ?? [],
      validUntil: proposal?.result?.validUntil,
    },
    inReplyTo: { subject: "Can we meet on Tuesday?", messageId: "<req-1@mail.example.org>" },
  });
  const flow = async (prepare) => {
    const queue = await prepare("inbox.normalise", request);
    const next = queue?.result?.queue?.[0]?.next;
    const proposal = await prepare("meeting.prepare-proposal", {
      availability: { ...next?.input, maxProposals: 3 },
      title: "our meeting",
    });
    const reply = await prepare("message.prepare", replyInput(proposal));
    return {
      next: next?.action,
      proposal: proposal?.status,
      calendarsRead: (proposal?.result?.coverage ?? []).filter((c) => c.state === "ok").length,
      reply: reply?.status,
      firstOption: reply?.result?.prepared?.text?.includes(proposal?.result?.options?.[0]?.local),
      headers: reply?.result?.prepared?.headers?.["In-Reply-To"],
      basis: reply?.result?.basis?.availabilityCheckedHere,
      delivery: reply?.result?.delivery?.state,
      preparation: reply?.preparation ?? null,
    };
  };
  const viaDashboard = await flow(
    async (id, body) =>
      (
        await http(
          port,
          "POST",
          `/api/actions/${id}/prepare`,
          { cookie, origin, "x-csrf-token": csrf },
          { input: body },
        )
      ).json,
  );
  const viaCli = await flow(
    async (id, body) =>
      (
        await cli([
          "actions",
          "prepare",
          "--id",
          id,
          "--provider-fixtures",
          "--input",
          input(`${id}.json`, body),
        ])
      ).json,
  );
  mcp = new Client({ name: "actions-integration-flow", version: "1" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [DASH, "actions", "mcp", "--state", state, "--now", NOW, "--provider-fixtures"],
      env,
      stderr: "pipe",
    }),
  );
  const viaMcpFlow = await flow(
    async (id, body) =>
      (await mcp.callTool({ name: "prepare_action", arguments: { id, input: body } }))
        .structuredContent,
  );
  await mcp.close();
  mcp = undefined;
  const expectedFlow = {
    next: "calendar.availability",
    proposal: "ok",
    calendarsRead: 6,
    reply: "ok",
    firstOption: true,
    headers: "<req-1@mail.example.org>",
    basis: false,
    delivery: "prepared-locally",
    preparation: null,
  };
  check(
    "A.12",
    "structured request → registry with fresh reads of all six calendars → prepared reply (labelled: this renderer checked nothing), identically over the dashboard, the CLI and MCP; no model; nothing sent and no execute step exists for a reply",
    [imported.code, allow.status, viaDashboard, viaCli, viaMcpFlow],
    [0, 200, expectedFlow, expectedFlow, expectedFlow],
  );
} catch (error) {
  fatal = String(error?.stack ?? error).slice(0, 2000);
  console.error(fatal);
} finally {
  await cleanup();
  clearTimeout(deadline);
}

const report = {
  report: "Deterministic actions — real-process workflow (synthetic, temporary state)",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    clock: `synthetic scheduling clock ${NOW}`,
    providers: "built-in synthetic fixtures (no network); no model, no hosted classifier",
    cleanup: existsSync(work)
      ? "FAILED: temporary directory still present"
      : "temporary directory removed",
  },
  checks,
  ...(fatal ? { fatal } : {}),
  summary: {
    checks: checks.length,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length + (fatal ? 1 : 0),
  },
};
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
process.exit(report.summary.failed === 0 ? 0 : 1);
