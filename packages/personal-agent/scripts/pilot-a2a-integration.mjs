#!/usr/bin/env node
// A2A + durable enterprise workflow (SYNTHETIC ONLY). Requires `npm run build` and a local SPARQ
// policy binary (explicit path; never the ambient `sparq` command).
//
// Every agent is an independently initialised directory served by its OWN OS process:
// `awp-pilot mcp --a2a [--a2a-auto-dispatch]` — the local MCP operator interface on stdio AND the
// optional loopback A2A listener (official @a2a-js/sdk, A2A protocol 1.0 JSON-RPC) of the same
// runtime. This harness is (a) the local OPERATOR, connected over MCP (official
// @modelcontextprotocol/sdk), and (b) for negative checks only, an A2A client using the pilot's
// own pinned-endpoint client. Peer messages between agents travel over A2A (plus one hop over
// the MCP binding); every carried message is a signed envelope verified by the receiving
// runtime. No LLM, no provider, no network beyond 127.0.0.1.
//
// Part A — two personal agents over A2A (one conversation all-A2A, one with a mixed MCP hop),
//          negative integrity/audience/replay/access checks, Agent Card.
// Part B — durable mortgage slice: consumer, lender intake and underwriter (roles), MCP operator
//          initiation, A2A peer transport, owner approval signed out of process, restarts of
//          the consumer (pending approval) and of the lender (after storage), replay after
//          restart, purpose-bound internal use, attenuated underwriting, final receipt.
//
// Usage: node scripts/pilot-a2a-integration.mjs --sparq-bin=PATH [--out reports/pilot-a2a-report.json]
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(root, "dist", "pilot", "cli.js");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "pilot-a2a-report.json");
const SPARQ_BIN = flag("sparq-bin") ?? process.env.AWP_SPARQ_POLICY_BIN;
const NOW = "2026-10-19T08:00:00Z"; // fixed synthetic clock
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
const a2a = await import(join(root, "dist", "pilot", "bindings", "a2a.js"));
const fixtures = await import(join(root, "dist", "pilot", "fixtures", "mortgage.js"));
const vocab = await import(join(root, "dist", "pilot", "profile", "vocabulary.js"));

const work = mkdtempSync(join(tmpdir(), "awp-a2a-"));
const dir = join(work, "agents");
/** Separate owner custody: owner keys live here, never in a service directory. */
const OWNERS = join(work, "owners");
/** Alice's private copy of the SPARQ binary (replaced under her running server in A.9). */
const ALICE_BIN = join(work, "sparq-policy-decide-alice");
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

/** One CLI command as its own OS process. */
function cli(args) {
  return new Promise((done) => {
    // `init` pins the explicit SPARQ binary (the default module) unless one is given, and puts
    // the owner key in the separate owner directory; later commands use the records.
    const extra =
      args[0] === "init"
        ? [
            ...(args.some((a) => a.startsWith("--sparq-bin")) ? [] : [`--sparq-bin=${SPARQ_BIN}`]),
            "--owner-dir",
            OWNERS,
          ]
        : [];
    const child = spawn(process.execPath, [CLI, ...args, "--dir", dir, "--now", NOW, ...extra], {
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

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** Start `awp-pilot mcp --a2a` for one agent and connect the official MCP client over stdio. */
async function connect(name, { auto = true } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      CLI,
      "mcp",
      "--name",
      name,
      "--a2a",
      ...(auto ? ["--a2a-auto-dispatch"] : []),
      "--dir",
      dir,
      "--now",
      NOW,
    ],
    stderr: "pipe",
  });
  diagnostics[name] = diagnostics[name] ?? [];
  transport.stderr?.on("data", (d) => diagnostics[name].push(...String(d).trim().split("\n")));
  const client = new Client({ name: "awp-a2a-integration", version: "0.1.0" });
  await client.connect(transport);
  steps.push({ process: `mcp+a2a server ${name}`, pid: transport.pid, event: "connected", auto });
  clients.set(name, { client, transport, pid: transport.pid });
}

async function disconnect(name) {
  const entry = clients.get(name);
  if (!entry) return;
  clients.delete(name);
  await entry.client.close(); // stdin closes: the server drains, closes its listener, exits
  steps.push({ process: `mcp+a2a server ${name}`, pid: entry.pid, event: "closed" });
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

async function until(what, predicate, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > end) {
      console.error(`timeout waiting for ${what}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const received = async (name) =>
  (await call(name, "get_evidence", { type: "message-in", limit: 100 })).records.map(
    (r) => `${r.record.kind}:${r.record.binding}`,
  );

async function provision(name, initArgs) {
  const r = await cli(["init", "--name", name, ...initArgs]);
  if (r.code !== 0) throw new Error(`init ${name}: ${r.stderr}`);
  writeFileSync(join(work, `${name}.card.json`), (await cli(["card", "--name", name])).stdout);
  const port = await freePort();
  const c = await cli([
    "a2a-config",
    "--name",
    name,
    "--port",
    String(port),
    "--out",
    join(work, `${name}.a2a.json`),
  ]);
  if (c.code !== 0) throw new Error(`a2a-config ${name}: ${c.stderr}`);
  return r.json;
}

async function pin(ids, who, peer, { a2aPin = true } = {}) {
  const p = await cli([
    "pin",
    "--name",
    who,
    "--card",
    join(work, `${peer}.card.json`),
    `--party-kid=${ids[peer].partyKid}`,
    `--actor-kid=${ids[peer].actorKid}`,
  ]);
  if (p.code !== 0) throw new Error(`pin ${who}→${peer}: ${p.stderr}`);
  if (a2aPin) {
    const q = await cli(["a2a-pin", "--name", who, "--connection", join(work, `${peer}.a2a.json`)]);
    if (q.code !== 0) throw new Error(`a2a-pin ${who}→${peer}: ${q.stderr}`);
  }
}

const connection = (name) => JSON.parse(readFileSync(join(work, `${name}.a2a.json`), "utf8"));
const asPeer = (name) => {
  const c = connection(name);
  return { actor: c.actor, url: c.url, token: c.token };
};

let exitCode = 1;
try {
  // =========================================================== Part A: personal agents over A2A
  const P = {
    alice: ["https://alice.example/#me", "https://agents.alice.example/personal#agent"],
    bob: ["https://bob.example/#me", "https://agents.bob.example/personal#agent"],
    carol: ["https://carol.example/#me", "https://agents.carol.example/personal#agent"],
  };
  const ids = {};
  copyFileSync(SPARQ_BIN, ALICE_BIN);
  chmodSync(ALICE_BIN, 0o755);
  for (const [name, [party, actor]] of Object.entries(P))
    ids[name] = await provision(name, [
      "--party",
      party,
      "--actor",
      actor,
      ...(name === "alice" ? [`--sparq-bin=${ALICE_BIN}`] : []),
      ...Object.entries(P)
        .filter(([n]) => n !== name)
        .flatMap(([, [p]]) => ["--known-party", p]),
    ]);
  await pin(ids, "alice", "bob");
  await pin(ids, "bob", "alice");
  await pin(ids, "carol", "alice", { a2aPin: false });
  check(
    "A.0",
    "separate owner custody: no service directory holds an owner private key; each owner key is in the owner directory (0600)",
    Object.keys(P).map((n) => [
      existsSync(join(dir, n, "keys", "owner.private.jwk.json")),
      existsSync(join(OWNERS, n, "owner.private.jwk.json")),
      (statSync(join(OWNERS, n, "owner.private.jwk.json")).mode & 0o077) === 0,
      String(ids[n].ownerCustody).startsWith("separate"),
    ]),
    Object.keys(P).map(() => [false, true, true, true]),
  );

  // Non-loopback / named / TLS / other-path endpoints are refused at pinning (no discovery).
  const refusedPins = [];
  for (const url of [
    "http://localhost:4000/a2a/jsonrpc",
    "http://192.0.2.10:4000/a2a/jsonrpc",
    "https://127.0.0.1:4000/a2a/jsonrpc",
    "http://127.0.0.1:4000/other",
  ]) {
    const f = join(work, "bad-connection.json");
    writeFileSync(f, JSON.stringify({ ...connection("bob"), url }));
    const r = await cli(["a2a-pin", "--name", "alice", "--connection", f]);
    refusedPins.push(r.code !== 0);
  }
  // An A2A connection never establishes trust: carol's endpoint cannot be pinned by bob before
  // carol's keys are.
  const noKeys = await cli([
    "a2a-pin",
    "--name",
    "bob",
    "--connection",
    join(work, "carol.a2a.json"),
  ]);
  check(
    "A.1",
    "pinning refuses non-loopback, named, TLS and other-path endpoints, and an endpoint whose actor keys are not pinned",
    [refusedPins, noKeys.code !== 0, /pin the peer's card/.test(noKeys.stderr)],
    [[true, true, true, true], true, true],
  );

  await connect("alice", { auto: false }); // alice's operator dispatches explicitly
  await connect("bob"); // bob auto-dispatches to pinned A2A peers
  await connect("carol");
  const pa = await call("alice", "get_profile");
  const a2aIface = pa.interfaces.find((i) => i.binding === "a2a-data-part/0.2");
  check(
    "A.2",
    "alice's profile: A2A binding advertised with its loopback endpoint and the exact SDK/protocol; SPARQ module ready",
    [
      pa.description.bindings.map((b) => b.id),
      /^http:\/\/127\.0\.0\.1:\d+\/a2a\/jsonrpc$/.test(a2aIface?.endpoint ?? ""),
      a2aIface?.transport,
      pa.policyModule.evaluator.name,
      pa.policyModule.status,
    ],
    [
      ["direct-local/0.1", "mcp-tool/0.1", "a2a-data-part/0.2"],
      true,
      "A2A 1.0 JSON-RPC on loopback (@a2a-js/sdk 1.2.1)",
      "sparq-policy",
      "ready",
    ],
  );

  // Conversation 1: every hop over A2A.
  const captured = [];
  const dispatchAlice = async () => {
    const { outbound = [] } = await call("alice", "list_outbound");
    captured.push(...outbound);
    return call("alice", "dispatch_outbound");
  };
  await call("alice", "propose_meeting", {
    peerActor: P.bob[1],
    windowStart: "2026-10-20T13:00:00Z",
    windowEnd: "2026-10-20T15:00:00Z",
  });
  const completed = async (name, n) => {
    const s = await call(name, "get_status");
    return s.conversations.filter((c) => c.phase === "completed").length === n;
  };
  await until("conversation 1", async () => {
    await dispatchAlice();
    return (await completed("alice", 1)) && (await completed("bob", 1));
  });
  const recvA1 = await received("alice");
  const recvB1 = await received("bob");
  const txA1 = (await call("alice", "get_status")).transmissions;
  check(
    "A.3",
    "two personal agents complete a scheduling conversation with every hop carried over A2A; each send has a durable transmission record (envelope id ↔ A2A id ↔ peer ack id)",
    [
      recvA1,
      recvB1,
      txA1.map((t) => [
        t.binding,
        t.status,
        t.externalId === a2a.a2aMessageIdFor(t.messageId),
        t.providerRef === `${a2a.ackMessageIdFor(t.externalId)}:accepted`,
      ]),
    ],
    [
      ["description:a2a-data-part/0.2", "accept:a2a-data-part/0.2", "receipt:a2a-data-part/0.2"],
      ["describe:a2a-data-part/0.2", "propose:a2a-data-part/0.2", "receipt:a2a-data-part/0.2"],
      [0, 1, 2].map(() => ["a2a-data-part/0.2", "sent", true, true]),
    ],
  );

  // Conversation 2: the first hop over the MCP binding, the rest over A2A (mixed bindings).
  await call("alice", "propose_meeting", {
    peerActor: P.bob[1],
    windowStart: "2026-10-21T13:00:00Z",
    windowEnd: "2026-10-21T15:00:00Z",
  });
  const { outbound: firstHop = [] } = await call("alice", "list_outbound");
  const describe = firstHop.find((o) => o.kind === "describe");
  const viaMcp = await call("bob", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(describe.envelope),
  });
  await call("alice", "ack_outbound", { ids: [describe.id] });
  await until("conversation 2", async () => {
    await dispatchAlice();
    return (await completed("alice", 2)) && (await completed("bob", 2));
  });
  const recvB2 = (await received("bob")).slice(3);
  const recvA2 = (await received("alice")).slice(3);
  check(
    "A.4",
    "mixed bindings in ONE conversation: describe over mcp-tool/0.1, every other hop over A2A; same checks and transitions",
    [viaMcp.step?.disposition, recvB2, recvA2],
    [
      "accepted",
      ["describe:mcp-tool/0.1", "propose:a2a-data-part/0.2", "receipt:a2a-data-part/0.2"],
      ["description:a2a-data-part/0.2", "accept:a2a-data-part/0.2", "receipt:a2a-data-part/0.2"],
    ],
  );

  // Negative checks against the running peer processes.
  const bobPeer = asPeer("bob");
  const propose = captured.find((o) => o.kind === "propose");
  const [h, p, s] = propose.envelope.jws.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  payload.createdAt = "2026-10-19T08:00:01Z";
  const tampered = {
    ...propose.envelope,
    jws: `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`,
  };
  const tamper = await a2a.sendEnvelope(bobPeer, { id: `${propose.id}#t`, wire: tampered });
  const replay = await a2a.sendEnvelope(bobPeer, { id: propose.id, wire: propose.envelope });
  const replayMcp = await call("bob", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(propose.envelope),
  });
  const wrongAudience = await a2a.sendEnvelope(asPeer("carol"), {
    id: propose.id,
    wire: propose.envelope,
  });
  const post = (headers, body) =>
    fetch(bobPeer.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: {} });
  const noToken = (await post({}, rpc)).status;
  const aliceTokenAtBob = (
    await post({ authorization: `Bearer ${connection("alice").token}` }, rpc)
  ).status;
  const oversized = (
    await post(
      { authorization: `Bearer ${bobPeer.token}` },
      JSON.stringify({ x: "y".repeat(400_000) }),
    )
  ).status;
  const browser = (
    await post({ authorization: `Bearer ${bobPeer.token}`, origin: "http://evil.example" }, rpc)
  ).status;
  const otherMethod = await (
    await post(
      { authorization: `Bearer ${bobPeer.token}` },
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "CreateTaskPushNotificationConfig",
        params: {},
      }),
    )
  ).json();
  const sb = await call("bob", "get_status");
  const sc = await call("carol", "get_status");
  check(
    "A.5",
    "over A2A: tampered → bad-signature; replay → duplicate (also across bindings via MCP); wrong audience → wrong-audience; no extra effect",
    [
      tamper.ack?.disposition,
      tamper.ack?.reason,
      replay.ack?.disposition,
      replayMcp.step?.disposition,
      wrongAudience.ack?.disposition,
      wrongAudience.ack?.reason,
      sb.conversations.length,
      Object.keys(sb.holds).length,
      sc.conversations.length,
    ],
    ["rejected", "bad-signature", "duplicate", "duplicate", "rejected", "wrong-audience", 2, 2, 0],
  );
  check(
    "A.6",
    "listener access: no token 401; another agent's token 401; oversized 413; browser Origin 403; only SendMessage (-32601)",
    [noToken, aliceTokenAtBob, oversized, browser, otherMethod.error?.code],
    [401, 401, 413, 403, -32601],
  );
  const cardRes = await fetch(bobPeer.url.replace("/a2a/jsonrpc", "/.well-known/agent-card.json"));
  const cardText = await cardRes.text();
  const card = JSON.parse(cardText);
  check(
    "A.7",
    "bob's Agent Card is accurate and public: JSONRPC 1.0 at the pinned URL, required carriage extension naming bob's actor, bearer scheme, no keys, tokens or local paths",
    [
      card.supportedInterfaces,
      card.capabilities.extensions.map((e) => [e.required, e.params.actor, e.params.binding]),
      card.capabilities.streaming,
      card.capabilities.pushNotifications,
      Object.keys(card.securitySchemes),
      cardText.includes(work),
      cardText.includes(bobPeer.token),
      /"d"\s*:|private/i.test(cardText),
    ],
    [
      [{ url: bobPeer.url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }], // proto JSON omits empty tenant
      [[true, P.bob[1], "a2a-data-part/0.2"]],
      false,
      false,
      ["localBearer"],
      false,
      false,
      false,
    ],
  );
  // Send-time authorisation across processes: alice's queued, already-signed propose is
  // re-decided at dispatch; with her pinned SPARQ binary replaced under her running server the
  // decision is indeterminate and NOTHING is sent (no transmission record, nothing at bob).
  await call("alice", "propose_meeting", {
    peerActor: P.bob[1],
    windowStart: "2026-10-22T13:00:00Z",
    windowEnd: "2026-10-22T15:00:00Z",
  });
  let queued;
  await until("alice's third propose is queued", async () => {
    const { outbound = [] } = await call("alice", "list_outbound");
    queued = outbound.find((o) => o.kind === "propose");
    if (!queued && outbound.length > 0) await call("alice", "dispatch_outbound"); // the describe
    return Boolean(queued);
  });
  const bobBefore = (await received("bob")).length;
  writeFileSync(ALICE_BIN, `${readFileSync(ALICE_BIN).subarray(0, 64).toString("latin1")}replaced`);
  const denied = await call("alice", "dispatch_outbound");
  const aliceAfter = await call("alice", "get_status");
  check(
    "A.9",
    "send-time authorisation: alice's queued signed propose is refused at dispatch after her pinned SPARQ binary is replaced — no transmission record, bob receives nothing",
    [
      denied.failed?.map((f) => [f.kind, f.status, f.reason]),
      aliceAfter.policyModule.status,
      aliceAfter.transmissions.some((t) => t.messageId === queued?.id),
      (await received("bob")).length - bobBefore,
      (await call("alice", "list_outbound")).outbound.some((o) => o.id === queued?.id),
    ],
    [[["propose", "refused", "not-authorised"]], "unavailable", false, 0, true],
  );

  const bobPid = clients.get("bob").pid;
  for (const n of ["alice", "bob", "carol"]) await disconnect(n);
  await until("bob exits", () => !alive(bobPid), 10_000);
  const stopped = await cli(["status", "--name", "bob"]);
  check(
    "A.8",
    "closing the MCP client stops the MCP+A2A server: listener closed, lock released, state saved",
    [
      alive(bobPid),
      diagnostics.bob.some((l) => /stopped; state saved and lock released/.test(l)),
      stopped.code,
      stopped.json.conversations?.slice(0, 2).map((c) => c.phase),
    ],
    [false, true, 0, ["completed", "completed"]],
  );

  // =========================================================== Part B: durable mortgage slice
  const issuance = await cli(["synthetic-issuers", "--out", join(work, "issuance")]);
  const mids = {};
  mids.sam = await provision("sam", [
    "--role",
    "mortgage-consumer",
    "--wallet",
    issuance.json.wallet,
  ]);
  mids.northbank = await provision("northbank", [
    "--role",
    "mortgage-lender",
    "--issuers",
    issuance.json.issuers,
  ]);
  mids.uw = await provision("uw", ["--role", "mortgage-underwriter"]);
  for (const [who, peer] of [
    ["sam", "northbank"],
    ["northbank", "sam"],
    ["northbank", "uw"],
    ["uw", "northbank"],
  ])
    await pin(mids, who, peer);
  const walletOnDisk = readFileSync(join(dir, "sam", "wallet.json"), "utf8");
  const issuerFile = JSON.parse(readFileSync(issuance.json.issuers, "utf8"));
  check(
    "B.0",
    "independent role directories: fixed synthetic identities, local issuer anchors at the lender only (public keys), wallet at the consumer only",
    [
      [mids.sam.actor, mids.northbank.actor, mids.uw.actor],
      issuerFile.issuers.map((i) => i.issuer),
      JSON.stringify(issuerFile).includes('"d"'),
      existsSync(join(dir, "northbank", "wallet.json")),
      JSON.parse(walletOnDisk).items.length > 0,
    ],
    [
      [fixtures.SAM.actor, fixtures.NORTH.actor, fixtures.UW.actor],
      [fixtures.PAYROLL, fixtures.DEPOSIT_BANK, fixtures.VALUER],
      false,
      false,
      true,
    ],
  );

  await connect("sam", { auto: false }); // the consumer's operator reviews, then dispatches
  await connect("northbank");
  await connect("uw");
  const tools = {};
  for (const n of ["sam", "northbank", "uw"])
    tools[n] = (await clients.get(n).client.listTools()).tools.map((t) => t.name).sort();
  const generic = [
    "ack_outbound",
    "deliver_inbound",
    "dispatch_outbound",
    "get_evidence",
    "get_profile",
    "get_status",
    "list_outbound",
    "submit_approval",
  ];
  check(
    "B.1",
    "narrow declared domain operations per role (no file, shell, trust-editing, approval-bypass or provider tools)",
    tools,
    {
      sam: [...generic, "start_prequalification"].sort(),
      northbank: [
        ...generic,
        "internal_access",
        "purge_expired",
        "send_decision_receipt",
        "start_underwriting",
      ].sort(),
      uw: generic,
    },
  );

  const capturedSam = [];
  const dispatchSam = async () => {
    const { outbound = [] } = await call("sam", "list_outbound");
    capturedSam.push(...outbound);
    if (outbound.length > 0) await call("sam", "dispatch_outbound");
  };
  const started = await call("sam", "start_prequalification", {
    lenderActor: fixtures.NORTH.actor,
    propertyPrice: 450000,
    loanAmount: 380000,
  });
  const application = started.step.conversation;
  let samStatus;
  await until("disclosure approval pending at sam", async () => {
    await dispatchSam();
    samStatus = await call("sam", "get_status");
    return samStatus.pendingApprovals.length === 1;
  });
  const pending = samStatus.pendingApprovals[0];

  // Restart the consumer's process while the disclosure awaits the owner.
  const samPid1 = clients.get("sam").pid;
  await disconnect("sam");
  await until("sam exits", () => !alive(samPid1), 10_000);
  await connect("sam", { auto: false });
  const samAfter = await call("sam", "get_status");
  const bogus = await call("sam", "submit_approval", { approval: "eyJhbGciOiJub25lIn0.e30.bogus" });
  const signArgs = [
    "sign-approval",
    "--name",
    "sam",
    "--action",
    pending.actionDigest,
    "--conversation",
    application,
  ];
  // The running service has no owner key; signing without the owner directory fails.
  const withoutOwner = await cli(signArgs);
  const signed = await cli([...signArgs, "--owner-dir", OWNERS]);
  const approved = await call("sam", "submit_approval", { approval: signed.json.approval });
  check(
    "B.2",
    "sam's process restarts at the pending approval with NO owner key in its service directory; an unsigned approval releases nothing; signing needs the separate owner directory; the owner approval (separate CLI process, no lock) releases exactly the pending action: accept + disclosure",
    [
      alive(samPid1),
      existsSync(join(dir, "sam", "keys", "owner.private.jwk.json")),
      samAfter.pendingApprovals.map((x) => x.actionDigest),
      pending.intent?.recipient,
      (bogus.outbound ?? []).length,
      [withoutOwner.code !== 0, /--owner-dir/.test(withoutOwner.stderr)],
      [signed.code, signed.json.ownerCustody],
      approved.step?.disposition,
      (approved.outbound ?? []).map((o) => o.kind),
    ],
    [
      false,
      false,
      [pending.actionDigest],
      fixtures.NORTH.party,
      0,
      [true, true],
      [0, "separate"],
      "accepted",
      ["accept", "deliver"],
    ],
  );
  let nbStatus;
  await until("evidence stored at the lender", async () => {
    await dispatchSam();
    nbStatus = await call("northbank", "get_status");
    return (nbStatus.domain?.dataStore ?? []).length >= 2 && nbStatus.undeliveredOutbound === 0;
  });
  const storeBefore = nbStatus.domain.dataStore;

  // Restart the lender after storage; then replay the consumer's disclosure over A2A and MCP.
  const nbPid1 = clients.get("northbank").pid;
  await disconnect("northbank");
  await until("northbank exits", () => !alive(nbPid1), 10_000);
  await connect("northbank");
  const nbAfter = await call("northbank", "get_status");
  const deliver = capturedSam.find((o) => o.kind === "deliver");
  const replayA2a = await a2a.sendEnvelope(asPeer("northbank"), {
    id: deliver.id,
    wire: deliver.envelope,
  });
  const replayMcpB = await call("northbank", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(deliver.envelope),
  });
  const nbAfterReplay = await call("northbank", "get_status");
  check(
    "B.3",
    "the lender's process restarts with evidence, grants and state preserved; a replayed disclosure (A2A or MCP) is a duplicate: no second storage, grants unchanged",
    [
      alive(nbPid1),
      JSON.stringify(nbAfter.domain.dataStore) === JSON.stringify(storeBefore),
      replayA2a.ack?.disposition,
      replayMcpB.step?.disposition,
      JSON.stringify(nbAfterReplay.domain.dataStore) === JSON.stringify(storeBefore),
      storeBefore.map((i) => i.claimType).sort(),
    ],
    [false, true, "duplicate", "duplicate", true, storeBefore.map((i) => i.claimType).sort()],
  );

  const permitted = await call("northbank", "internal_access", {
    agent: fixtures.NB_ASSESS,
    action: "read",
    purpose: vocab.PURPOSE.creditChecking,
    application,
  });
  const marketing = await call("northbank", "internal_access", {
    agent: fixtures.NB_MARKETING,
    action: "read",
    purpose: vocab.PURPOSE.marketing,
    application,
  });
  const relabelled = await call("northbank", "internal_access", {
    agent: fixtures.NB_MARKETING,
    action: "read",
    purpose: vocab.PURPOSE.creditChecking,
    application,
  });
  const broker = await call("northbank", "internal_access", {
    agent: fixtures.NORTH.actor,
    action: "distribute",
    purpose: vocab.PURPOSE.creditChecking,
    recipient: fixtures.DATA_BROKER,
    application,
  });
  check(
    "B.4",
    "purpose-bound enforcement point: assessment read permitted; marketing refused (also when relabelled as credit checking); onward to a data broker refused",
    [
      permitted.decision,
      Boolean(permitted.items?.length),
      marketing.decision,
      marketing.items,
      relabelled.decision,
      broker.decision,
    ],
    ["permit", true, "deny", undefined, "deny", "deny"],
  );

  const uwStart = await call("northbank", "start_underwriting", { application });
  const uwAgain = await call("northbank", "start_underwriting", { application });
  await until("underwriting completed", async () => {
    const s = await call("uw", "get_status");
    const n = await call("northbank", "get_status");
    return (
      s.conversations[0]?.phase === "completed" &&
      n.conversations.filter((c) => c.phase === "completed").length >= 1 &&
      n.undeliveredOutbound === 0
    );
  });
  const uwStatus = await call("uw", "get_status");
  const uwRecv = await received("uw");
  check(
    "B.5",
    "lender → underwriter over A2A under attenuated terms (only the named fields); once per application; the underwriter completes",
    [
      uwStart.attenuatedFields?.slice().sort(),
      Boolean(uwAgain.error) && /already requested/.test(uwAgain.error),
      uwStatus.conversations.map((c) => c.phase),
      uwRecv.every((r) => r.endsWith(":a2a-data-part/0.2")),
      uwStatus.conversations[0]?.peer?.party,
    ],
    [
      ["annualGrossIncome", "depositBalance", "loanAmount", "propertyPrice"],
      true,
      ["completed"],
      true,
      fixtures.NORTH.party,
    ],
  );

  const decided = await call("northbank", "send_decision_receipt", { application });
  const decidedAgain = await call("northbank", "send_decision_receipt", { application });
  await until("final receipt at sam", async () => {
    const s = await call("sam", "get_status");
    return s.conversations.find((c) => c.id === application)?.phase === "completed";
  });
  const samFinal = await call("sam", "get_status");
  const nbFinal = await call("northbank", "get_status");
  const samRecv = await received("sam");
  const nbRecv = await received("northbank");
  check(
    "B.6",
    "the final indicative receipt reaches the consumer over A2A (once); both sides complete; store unchanged; every processed peer message arrived over A2A (the replay probes were duplicates, not processed)",
    [
      decided.decided,
      Boolean(decidedAgain.error) && /already sent/.test(decidedAgain.error),
      samFinal.conversations.find((c) => c.id === application)?.phase,
      JSON.stringify(nbFinal.domain.dataStore) === JSON.stringify(storeBefore),
      samRecv.every((r) => r.endsWith(":a2a-data-part/0.2")),
      nbRecv.filter((r) => !r.endsWith(":a2a-data-part/0.2")),
    ],
    ["indicatively-eligible", true, "completed", true, true, []],
  );

  const decisions = {};
  for (const n of ["sam", "northbank", "uw"]) {
    const e = await call(n, "get_evidence", { type: "authorisation-decision", limit: 100 });
    decisions[n] = e.records.map((r) => r.record.policy?.evaluator ?? "none");
  }
  check(
    "B.7",
    "every owner-mandate decision in all three role processes was made by the pinned SPARQ binary (no fallback)",
    Object.fromEntries(
      Object.entries(decisions).map(([n, d]) => [
        n,
        d.length > 0 && d.every((x) => String(x).startsWith("sparq-policy@")),
      ]),
    ),
    { sam: true, northbank: true, uw: true },
  );

  for (const n of ["sam", "northbank", "uw"]) await disconnect(n);
  await new Promise((r) => setTimeout(r, 300));
  const post6 = {};
  for (const n of ["sam", "northbank", "uw"]) {
    const g = await cli(["governance", "--name", n]);
    const v = await cli(["verify-ledger", "--name", n]);
    post6[n] = [g.code, v.json.ok === true];
  }
  const storeLedger = readFileSync(join(dir, "northbank", "data-store-ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).record);
  check(
    "B.8",
    "after shutdown: every retained file is registered (governance exit 0), ledgers verify, the enforcement ledger stored each item exactly once and holds no payloads",
    [
      post6,
      storeLedger.filter((r) => r.type === "data-stored").length === storeBefore.length,
      storeLedger.some((r) => "data" in r),
    ],
    [{ sam: [0, true], northbank: [0, true], uw: [0, true] }, true, false],
  );
  exitCode = checks.every((c) => c.pass) ? 0 : 1;
} catch (error) {
  console.error(error);
  checks.push({
    id: "harness",
    claim: "harness ran to completion",
    pass: false,
    error: String(error),
  });
} finally {
  for (const n of [...clients.keys()]) await disconnect(n).catch(() => undefined);
  const report = {
    generatedAt: new Date().toISOString(),
    synthetic: true,
    clock: NOW,
    sparqBinary: "explicit path (not recorded here)",
    a2aSdk: a2a.A2A_SDK,
    binding: a2a.A2A_BINDING,
    labels: {
      tested:
        "separate OS processes on this host; MCP stdio operator; A2A 1.0 JSON-RPC over 127.0.0.1 with the official SDK; real SPARQ decisions",
      simulated:
        "all parties, issuers, evidence and outcomes are synthetic; the loan decision is an indicative fixture rule",
      notTested:
        "independent-vendor A2A interoperability, non-loopback networks, TLS, deployment, real accounts, hardware or OS-level owner-key custody (owner keys are only in a separate directory of the same OS user)",
    },
    summary: {
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
    },
    checks,
    steps,
    diagnostics,
  };
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ written: OUT, summary: report.summary }));
  rmSync(work, { recursive: true, force: true });
  process.exit(exitCode);
}
