#!/usr/bin/env node
// Durable REGIONAL workflows across independent OS processes (SYNTHETIC ONLY). Requires
// `npm run build` and a local SPARQ policy binary (explicit path; never the ambient `sparq`).
//
// Every actor is an independently initialised agent directory with SEPARATE owner custody
// (owner keys under a task-owned owner directory), served by its own `awp-pilot mcp` process
// (MCP operator interface on stdio + the loopback carriage it needs). This harness is the local
// operator: it provisions, starts ONLY its own processes, drives the real message exchanges
// through operator tools, restarts processes, writes a machine-readable report and cleans up
// its processes and temporary directory. No network beyond 127.0.0.1; nothing real.
//
//   Part E — Australian public energy comparison (anonymous public carriage).
//   Part H — US synthetic health-summary flow (A2A between patient agent and services).
//   Part I — EU industrial enterprise flow (A2A between five actors of three organisations).
//
// Usage: node scripts/pilot-regional-integration.mjs --sparq-bin=PATH
//          [--only=E,H,I] [--out=reports/pilot-regional-report.json]
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
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
const OUT = flag("out") ?? join(root, "reports", "pilot-regional-report.json");
const ONLY = (flag("only") ?? "E,H,I").split(",");
const SPARQ_BIN = flag("sparq-bin") ?? process.env.AWP_SPARQ_POLICY_BIN;
const NOW = "2026-10-19T08:00:00Z"; // fixed synthetic clock
if (!existsSync(CLI)) {
  console.error("build first: npm run build");
  process.exit(2);
}
if (!SPARQ_BIN || !existsSync(SPARQ_BIN)) {
  console.error("setup-required: pass --sparq-bin=PATH (or AWP_SPARQ_POLICY_BIN)");
  process.exit(3);
}
const dist = (p) => import(join(root, "dist", "pilot", p));

const work = mkdtempSync(join(tmpdir(), "awp-regional-"));
const dir = join(work, "agents");
const OWNERS = join(work, "owners");
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

function cli(args, extraEnv = {}) {
  return new Promise((done) => {
    const extra = args[0] === "init" ? [`--sparq-bin=${SPARQ_BIN}`] : [];
    const child = spawn(process.execPath, [CLI, ...args, "--dir", dir, "--now", NOW, ...extra], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
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

/** Start `awp-pilot mcp` for one agent (+ carriage flags) as its own OS process. */
async function connect(name, flags, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp", "--name", name, ...flags, "--dir", dir, "--now", NOW],
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  diagnostics[name] = diagnostics[name] ?? [];
  transport.stderr?.on("data", (d) => diagnostics[name].push(...String(d).trim().split("\n")));
  const client = new Client({ name: "awp-regional-integration", version: "0.1.0" });
  await client.connect(transport);
  steps.push({ process: `mcp ${name}`, pid: transport.pid, flags, event: "connected" });
  clients.set(name, { client, pid: transport.pid, flags });
}

async function disconnect(name) {
  const entry = clients.get(name);
  if (!entry) return;
  clients.delete(name);
  await entry.client.close();
  steps.push({ process: `mcp ${name}`, pid: entry.pid, event: "closed" });
  await until(`${name} exits`, () => !alive(entry.pid), 10_000);
}

async function call(name, tool, args = {}) {
  const r = await clients.get(name).client.callTool({ name: tool, arguments: args });
  steps.push({ tool: `${name}.${tool}`, isError: Boolean(r.isError) });
  if (r.isError) return { error: r.content?.[0]?.text ?? "error" };
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
}

async function tools(name) {
  return (await clients.get(name).client.listTools()).tools.map((t) => t.name).sort();
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

function filesUnder(d) {
  if (!existsSync(d)) return [];
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}
const textOf = (d) =>
  filesUnder(d)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

/** init + card; optional carriage config; returns init JSON. */
async function provision(name, initArgs, carriage) {
  const r = await cli(["init", "--name", name, "--owner-dir", OWNERS, ...initArgs]);
  if (r.code !== 0) throw new Error(`init ${name}: ${r.stderr}`);
  writeFileSync(join(work, `${name}.card.json`), (await cli(["card", "--name", name])).stdout);
  if (carriage === "public") {
    const c = await cli([
      "public-config",
      "--name",
      name,
      "--port",
      String(await freePort()),
      "--out",
      join(work, `${name}.endpoint.json`),
    ]);
    if (c.code !== 0) throw new Error(`public-config ${name}: ${c.stderr}`);
  }
  if (carriage === "a2a") {
    const c = await cli([
      "a2a-config",
      "--name",
      name,
      "--port",
      String(await freePort()),
      "--out",
      join(work, `${name}.a2a.json`),
    ]);
    if (c.code !== 0) throw new Error(`a2a-config ${name}: ${c.stderr}`);
  }
  return r.json;
}

async function pinCard(ids, who, peer) {
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
}
async function pinA2a(who, peer) {
  const q = await cli(["a2a-pin", "--name", who, "--connection", join(work, `${peer}.a2a.json`)]);
  if (q.code !== 0) throw new Error(`a2a-pin ${who}→${peer}: ${q.stderr}`);
}

const TERMINAL = new Set([
  "completed",
  "refused",
  "unsupported",
  "indeterminate",
  "failed",
  "expired",
]);
/**
 * Nothing left to send and every conversation in a terminal phase. `alsoFinal` adds phases that
 * are final for the operation at hand (a negotiation-only operation such as the health
 * authorisation ends at "agreed": its agreement IS the result, there is nothing to invoke).
 */
async function settledAt(name, alsoFinal = []) {
  const s = await call(name, "get_status");
  return (
    s.undeliveredOutbound === 0 &&
    s.conversations.every((c) => TERMINAL.has(c.phase) || alsoFinal.includes(c.phase))
  );
}

/** The newest ≤ 100 evidence records of one type (a tool error fails the harness loudly). */
const evidence = async (name, type, limit = 100) => {
  const r = await call(name, "get_evidence", { type, limit });
  if (r.error) throw new Error(`get_evidence ${name}/${type}: ${r.error}`);
  return (r.records ?? []).map((e) => e.record);
};

// ================================================================== Part E — energy
async function partE() {
  const f = await dist("fixtures/energy.js");
  const { runEnergy } = await dist("scenarios/energy.js");
  const retailerFixtures = [f.SOUTHERN, f.HARBOUR, f.GATED, f.OLDSCHEMA];
  const syn = await cli(["synthetic-energy", "--out", join(work, "energy-inputs")]);
  const ids = {};
  for (const r of retailerFixtures)
    ids[r.name] = await provision(
      r.name,
      [
        "--role",
        "energy-retailer",
        "--party",
        r.party,
        "--actor",
        r.actor,
        "--role-input",
        `plans=${syn.json.files[`plans-${r.name}.json`]}`,
      ],
      "public",
    );
  ids.wattlecompare = await provision("wattlecompare", [
    "--role",
    "energy-comparator",
    "--role-input",
    `profile=${syn.json.files["household.json"]}`,
  ]);
  for (const r of retailerFixtures) {
    await pinCard(ids, "wattlecompare", r.name);
    const q = await cli([
      "public-pin",
      "--name",
      "wattlecompare",
      "--connection",
      join(work, `${r.name}.endpoint.json`),
    ]);
    if (q.code !== 0) throw new Error(`public-pin: ${q.stderr}`);
  }
  const roles = await cli(["roles"]);
  check(
    "E.0",
    "role metadata is discoverable (roles command); retailers and comparator are separate actors with separate owner custody",
    [
      roles.json
        .filter((r) => r.id.startsWith("energy-"))
        .map((r) => [r.id, Object.keys(r.inputs)]),
      [...retailerFixtures.map((r) => r.name), "wattlecompare"].map(
        (n) =>
          existsSync(join(OWNERS, n, "owner.private.jwk.json")) &&
          !existsSync(join(dir, n, "keys", "owner.private.jwk.json")),
      ),
    ],
    [
      [
        ["energy-retailer", ["plans"]],
        ["energy-comparator", ["profile"]],
      ],
      [true, true, true, true, true],
    ],
  );

  for (const r of retailerFixtures) await connect(r.name, ["--public"]);
  await connect("wattlecompare", ["--public", "--auto-dispatch"]);
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
    "E.1",
    "exact per-role tools: the comparator adds request_plans/compare_plans; retailers add nothing (no free-form tools)",
    [await tools("wattlecompare"), await tools(f.SOUTHERN.name)],
    [[...generic, "compare_plans", "request_plans"].sort(), generic],
  );

  const started = await call("wattlecompare", "request_plans", {});
  await until("all public conversations settle", () => settledAt("wattlecompare"));
  const comparison = await call("wattlecompare", "compare_plans", {});
  const reference = await runEnergy(() => new Date(NOW));
  const pick = (r) => [r.retailer, r.planId, r.estimateAudPerYear];
  check(
    "E.2",
    "deterministic estimates across processes equal the in-process scenario (same domain code); every ranked plan cites a signed source; retailer figures vs derivations kept apart",
    [
      (comparison.ranked ?? []).map(pick),
      comparison.deterministic,
      (comparison.ranked ?? []).every((r) =>
        comparison.sources.some((s) => s.messageId === r.sourceMessage),
      ),
      Object.keys(comparison.ranked?.[0]?.trace ?? {}),
    ],
    [reference.obs.ranked.map(pick), true, true, ["assertedByRetailer", "derivedByComparator"]],
  );
  check(
    "E.3",
    "incompatible model version (old schema) and represented-only access are isolated, not ranked; invalid and conflicting plans excluded with reasons",
    [
      comparison.incompatibilities.map((i) => i.retailer).sort(),
      comparison.rejected.map((r) => r.planId),
      comparison.excluded.map((e) => e.planId).sort(),
    ],
    [
      [f.GATED.actor, f.OLDSCHEMA.actor].sort(),
      reference.obs.rejected.map((r) => r.planId),
      reference.obs.excluded.map((e) => e.planId).sort(),
    ],
  );

  // Service-boundary evidence at each retailer: anonymous request records, no identity.
  const atRetailers = {};
  for (const r of retailerFixtures) {
    const reqs = await evidence(r.name, "public-request");
    const ins = await evidence(r.name, "message-in");
    atRetailers[r.name] = {
      requests: reqs.length,
      credentialHeaders: [...new Set(reqs.flatMap((q) => q.credentialHeaders))],
      identifiedSenders: ins.filter((m) => m.from).length,
    };
  }
  check(
    "E.4",
    "at every retailer's own boundary: requests arrived with NO credential headers and NO identified sender (anonymous public profile)",
    Object.values(atRetailers).map((a) => [
      a.requests > 0,
      a.credentialHeaders,
      a.identifiedSenders,
    ]),
    retailerFixtures.map(() => [true, [], 0]),
  );

  // Public listener limits (observed at a running retailer process).
  const southernUrl = JSON.parse(
    readFileSync(join(work, `${f.SOUTHERN.name}.endpoint.json`), "utf8"),
  ).url;
  const post = (body, headers = {}) =>
    fetch(southernUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  const signedReq = (
    await post(JSON.stringify({ wire: { format: "awp-jws-compact/0.1", jws: "a.b.c" } }))
  ).status;
  const big = (await post(JSON.stringify({ pad: "x".repeat(70_000) }))).status;
  const browser = (await post("{}", { origin: "http://evil.example" })).status;
  check(
    "E.5",
    "public carriage limits: signed/identified request 400, oversized 413, browser Origin 403 (no token is ever asked for)",
    [signedReq, big, browser],
    [400, 413, 403],
  );

  // Restart the comparator process: outputs and provenance persist; re-computation identical.
  const before = (await call("wattlecompare", "get_status")).domain;
  await disconnect("wattlecompare");
  await connect("wattlecompare", ["--public", "--auto-dispatch"]);
  const after = (await call("wattlecompare", "get_status")).domain;
  const again = await call("wattlecompare", "compare_plans", {});
  check(
    "E.6",
    "comparator process restart preserves the last comparison and its provenance; re-running it gives the identical ranking and sources",
    [
      JSON.stringify(after) === JSON.stringify(before),
      JSON.stringify(again.ranked) === JSON.stringify(comparison.ranked),
      JSON.stringify(again.sources) === JSON.stringify(comparison.sources),
    ],
    [true, true, true],
  );

  // CRASH (SIGKILL) of the comparator process AFTER a public reply was received and BEFORE it was
  // processed (synthetic fault point). The reply was retained durably; the restarted process
  // processes it through the runtime; the round completes with one contribution per retailer
  // and NO re-request of the retained exchange.
  const requestsAt = async () => {
    let n = 0;
    for (const r of retailerFixtures) n += (await evidence(r.name, "public-request")).length;
    return n;
  };
  const round1Requests = await requestsAt();
  await disconnect("wattlecompare");
  await connect("wattlecompare", ["--public", "--auto-dispatch"], {
    AWP_SYNTHETIC_FAULT: "public-kill-after-receipt",
  });
  const faultPid = clients.get("wattlecompare").pid;
  await call("wattlecompare", "request_plans", {}).catch(() => ({}));
  const killed = await until("comparator killed after reply receipt", () => !alive(faultPid));
  const dead = clients.get("wattlecompare");
  clients.delete("wattlecompare");
  await dead.client.close().catch(() => undefined);
  const spool = JSON.parse(
    readFileSync(join(dir, "wattlecompare", "public-replies.json"), "utf8"),
  ).replies;
  const afterCrashRequests = await requestsAt();
  await connect("wattlecompare", ["--public", "--auto-dispatch"]); // recovers at start
  await until("round 2 settles after restart", () => settledAt("wattlecompare"));
  const recovered = await call("wattlecompare", "compare_plans", {});
  const received = await evidence("wattlecompare", "public-reply-received");
  check(
    "E.8",
    "a comparator PROCESS killed after a public reply was received and before it was processed loses nothing: the reply was retained; the restarted process processes it; the new round ranks exactly the reference (one contribution per retailer) with exactly as many retailer requests as round 1 (no re-request of the retained exchange)",
    [
      killed,
      spool.length,
      afterCrashRequests - round1Requests,
      (recovered.ranked ?? []).map(pick),
      (await requestsAt()) - round1Requests,
      received.length > 0,
      JSON.parse(readFileSync(join(dir, "wattlecompare", "public-replies.json"), "utf8")).replies
        .length,
    ],
    [true, 1, 1, reference.obs.ranked.map(pick), round1Requests, true, 0],
  );

  for (const n of [...retailerFixtures.map((r) => r.name), "wattlecompare"]) await disconnect(n);
  const household = JSON.parse(readFileSync(syn.json.files["household.json"], "utf8"));
  const leaks = retailerFixtures.map((r) => {
    const t = textOf(join(dir, r.name));
    return [
      t.includes(household.household),
      t.includes(f.WATTLE.party),
      t.includes(f.WATTLE.actor),
      /"usage"/.test(t),
    ];
  });
  const gov = [];
  for (const n of [...retailerFixtures.map((r) => r.name), "wattlecompare"]) {
    const g = await cli(["governance", "--name", n]);
    const v = await cli(["verify-ledger", "--name", n]);
    gov.push([g.code, v.json.ok === true]);
  }
  check(
    "E.7",
    "after shutdown: no retailer directory contains the household marker, the comparator's identity or usage; every directory's files are registered; ledgers verify",
    [leaks, gov],
    [retailerFixtures.map(() => [false, false, false, false]), gov.map(() => [0, true])],
  );
  return { started: started.round };
}

// ================================================================== Part H — health summary
async function partH() {
  const h = await dist("fixtures/health.js");
  const a2aFlags = ["--a2a", "--auto-dispatch"];
  const syn = await cli(["synthetic-health", "--out", join(work, "health-inputs")]);
  const Patients = [
    [h.CAREBRIEF, h.PATIENT_ID],
    [h.CAREBRIEF_NOAH, h.NOAH_PATIENT_ID],
  ];
  const Services = ["cv-auth", "cv-fhir", "cv-archive"];
  const All = ["carebrief", "carebrief-noah", ...Services];
  const ids = {};
  for (const [p, patientId] of Patients)
    ids[p.name] = await provision(
      p.name,
      [
        "--role",
        "health-patient",
        "--party",
        p.party,
        "--actor",
        p.actor,
        "--role-input",
        `patient-id=${patientId}`,
      ],
      "a2a",
    );
  ids["cv-auth"] = await provision(
    "cv-auth",
    [
      "--role",
      "health-authorization",
      "--role-input",
      `enrollments=${syn.json.enrollments}`,
      "--owner-name",
      "cedarvalley",
    ],
    "a2a",
  );
  const issuerCard = join(work, "token-issuer.json");
  writeFileSync(issuerCard, (await cli(["issuer-card", "--name", "cv-auth"])).stdout);
  for (const r of [h.CV_FHIR, h.CV_ARCHIVE])
    ids[r.name] = await provision(
      r.name,
      [
        "--role",
        "health-resource",
        "--party",
        r.party,
        "--actor",
        r.actor,
        "--role-input",
        `resources=${syn.json.resources}`,
        "--role-input",
        `issuers=${issuerCard}`,
        "--owner-name",
        "cedarvalley",
      ],
      "a2a",
    );
  for (const [p] of Patients)
    for (const s of Services) {
      await pinCard(ids, p.name, s);
      await pinCard(ids, s, p.name);
      await pinA2a(p.name, s);
      await pinA2a(s, p.name);
    }
  const issuerKid = JSON.parse(readFileSync(issuerCard, "utf8")).issuers[0].kid;
  check(
    "H.0",
    "separate owner custody (one owner key per patient; ONE shared organisation key for the Cedar Valley services, independent actor keys); the token-issuer key is a third, separate key; the clinic's enrollment register is provisioned at the authorisation service",
    [
      existsSync(join(OWNERS, "cedarvalley", "owner.private.jwk.json")),
      All.map((n) => existsSync(join(dir, n, "keys", "owner.private.jwk.json"))),
      ids["cv-auth"].partyKid === ids["cv-fhir"].partyKid,
      ids["cv-auth"].actorKid !== ids["cv-fhir"].actorKid,
      [issuerKid !== ids["cv-auth"].partyKid, issuerKid !== ids["cv-auth"].actorKid],
      existsSync(join(dir, "cv-auth", "patient-enrollments.json")),
    ],
    [true, All.map(() => false), true, true, [true, true], true],
  );

  for (const n of All) await connect(n, a2aFlags);
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
  const fhirProfile = await call("cv-fhir", "get_profile");
  check(
    "H.1",
    "exact per-role tools (read-only patient agent; services add only accept_revocation); the resource service describes NO write operation",
    [
      await tools("carebrief"),
      await tools("cv-auth"),
      await tools("cv-fhir"),
      fhirProfile.description.operations.map((o) => o.id).some((id) => /write/.test(id)),
    ],
    [
      [...generic, "current_grant", "read_resources", "request_access", "summarise"].sort(),
      [...generic, "accept_revocation"].sort(),
      [...generic, "accept_revocation"].sort(),
      false,
    ],
  );

  const approved = [
    "launch/patient",
    "patient/Patient.r",
    "patient/MedicationRequest.rs",
    "patient/AllergyIntolerance.rs",
  ];
  const consent = (name, patientId) =>
    cli([
      "owner-sign",
      "--name",
      name,
      "--owner-dir",
      OWNERS,
      "--kind",
      "patient-authorisation",
      "--args",
      JSON.stringify({ audience: h.CV_AUTH.actor, approvedScopes: approved, patientId }),
    ]);
  const lastOf = async (name) => {
    const c = (await call(name, "get_status")).conversations.at(-1);
    return `${c.phase}${c.closedReason ? `:${c.closedReason.split(":")[0]}` : ""}`;
  };
  const ask = async (name, patientId, authorisation) => {
    await call(name, "request_access", {
      authServerActor: h.CV_AUTH.actor,
      authorisation,
      patientId,
    });
    await until(`authorisation ${name}`, () => settledAt(name, ["agreed"]));
    return lastOf(name);
  };
  // Cross-patient issuance with AUTHENTIC owner signatures, both directions → refused.
  const mayaForNoah = await consent("carebrief", h.NOAH_PATIENT_ID);
  const cross1 = await ask("carebrief", h.NOAH_PATIENT_ID, mayaForNoah.json.statement);
  const noahForMaya = await consent("carebrief-noah", h.PATIENT_ID);
  const cross2 = await ask("carebrief-noah", h.PATIENT_ID, noahForMaya.json.statement);
  const pa = await consent("carebrief", h.PATIENT_ID);
  const own1 = await ask("carebrief", h.PATIENT_ID, pa.json.statement);
  const noahPa = await consent("carebrief-noah", h.NOAH_PATIENT_ID);
  const own2 = await ask("carebrief-noah", h.NOAH_PATIENT_ID, noahPa.json.statement);
  const decisions = await evidence("cv-auth", "consent-decision");
  const scopes = await evidence("cv-auth", "scope-decision");
  check(
    "H.2",
    "issuance authority: an authentic consent for ANOTHER patient's compartment is refused (both directions) against the clinic's enrollment register; each patient's own consent is granted exactly requested ∩ approved ∩ supported; issued grants name the enrolled principal",
    [
      [mayaForNoah.json.ownerCustody, cross1, cross2, own1, own2],
      decisions.map((d) => d.detail),
      scopes.map((s) => [s.patient, s.patientId, s.granted]),
    ],
    [
      ["separate", "refused:not-authorised", "refused:not-authorised", "agreed", "agreed"],
      [
        "the requested compartment is not the enrolled compartment of this patient",
        "the requested compartment is not the enrolled compartment of this patient",
      ],
      [
        [h.CAREBRIEF.party, h.PATIENT_ID, approved],
        [h.CAREBRIEF_NOAH.party, h.NOAH_PATIENT_ID, approved],
      ],
    ],
  );

  /** One read; waits for ITS conversation (a withheld earlier reply may keep another open). */
  const read = async (resourceType, server = h.CV_FHIR.actor, patientId, name = "carebrief") => {
    const started = await call(name, "read_resources", {
      resourceServerActor: server,
      resourceType,
      ...(patientId ? { patientId } : {}),
    });
    const id = started.step?.conversation;
    let c;
    await until(`read ${resourceType}`, async () => {
      c = (await call(name, "get_status")).conversations.find((x) => x.id === id);
      return Boolean(c && TERMINAL.has(c.phase));
    });
    return c ? `${c.phase}${c.closedReason ? `:${c.closedReason.split(":")[0]}` : ""}` : "absent";
  };
  const reads = {
    Patient: await read("Patient"),
    MedicationRequest: await read("MedicationRequest"),
    AllergyIntolerance: await read("AllergyIntolerance"),
    Observation: await read("Observation"),
    otherPatient: await read("MedicationRequest", h.CV_FHIR.actor, h.NOAH_PATIENT_ID),
    wrongAudience: await read("MedicationRequest", h.CV_ARCHIVE.actor),
    noahOwn: await read("MedicationRequest", h.CV_FHIR.actor, undefined, "carebrief-noah"),
  };
  const accessIds = (await evidence("cv-fhir", "audit-access")).map((a) => a.ids);
  check(
    "H.3",
    "restricted read scopes: granted types read; Observation, ANOTHER patient's compartment and a grant for another server refused — observed at the RESOURCE services' own audit; each patient's reads release only that patient's records",
    [
      Object.values(reads).map((r) => r.split(":")[0]),
      (await evidence("cv-fhir", "audit-denial")).map((d) => d.reason),
      (await evidence("cv-archive", "audit-denial")).map((d) => d.reason),
      accessIds.flat().filter((id) => id.includes(h.NOAH_PATIENT_ID)),
    ],
    [
      ["completed", "completed", "completed", "refused", "refused", "refused", "completed"],
      ["insufficient-scope", "insufficient-scope"],
      ["grant-invalid"],
      [`MedicationRequest/${h.NOAH_PATIENT_ID}-mr-1`],
    ],
  );

  const summary = await call("carebrief", "summarise", {});
  check(
    "H.4",
    "minimised summary: every statement cites Type/id/_history/version @ source; contradictions stay unresolved; nothing from the un-granted Observation scope or another patient",
    [
      summary.statements.length > 0,
      summary.statements.every((s) =>
        s.cites.every((c) => /\/_history\/\d+ @ https:\/\/cedarvalley\.example\/fhir$/.test(c)),
      ),
      summary.unresolved > 0,
      /Observation\/|metformin|synthetic-noah/.test(JSON.stringify(summary)),
      summary.notClaimed.includes("clinical advice"),
    ],
    [true, true, true, false, true],
  );

  // Revocation ownership: Noah (authentic owner signature) over MAYA's grant → refused at both
  // enforcing servers; Maya over her own → accepted.
  const mayaGrant = await call("carebrief", "current_grant");
  const cross = await cli([
    "owner-sign",
    "--name",
    "carebrief-noah",
    "--owner-dir",
    OWNERS,
    "--kind",
    "grant-revocation",
    "--args",
    JSON.stringify({ grant: mayaGrant.grant }),
  ]);
  const crossAuth = await call("cv-auth", "accept_revocation", {
    revocation: cross.json.statement,
  });
  const crossFhir = await call("cv-fhir", "accept_revocation", {
    revocation: cross.json.statement,
  });

  // A PROTECTED reply queued before the revocation must not leave after it (zero delivery),
  // live and after a process restart. cv-fhir runs WITHOUT auto-dispatch for this step.
  await disconnect("cv-fhir");
  await connect("cv-fhir", ["--a2a"]);
  const inBefore = (await evidence("carebrief", "message-in")).length;
  await call("carebrief", "read_resources", {
    resourceServerActor: h.CV_FHIR.actor,
    resourceType: "MedicationRequest",
  });
  let queued;
  await until("searchset queued at cv-fhir", async () => {
    queued = (await call("cv-fhir", "list_outbound")).outbound.find((o) => o.kind === "deliver");
    return Boolean(queued);
  });
  const rev = await cli([
    "owner-sign",
    "--name",
    "carebrief",
    "--owner-dir",
    OWNERS,
    "--kind",
    "grant-revocation",
    "--args",
    JSON.stringify({ grant: mayaGrant.grant }),
  ]);
  const atAuth = await call("cv-auth", "accept_revocation", { revocation: rev.json.statement });
  const atFhir = await call("cv-fhir", "accept_revocation", { revocation: rev.json.statement });
  const withheld = await call("cv-fhir", "dispatch_outbound");
  const listed = (await call("cv-fhir", "list_outbound")).outbound.find((o) => o.id === queued.id);
  await disconnect("cv-fhir");
  await connect("cv-fhir", a2aFlags); // auto-dispatch at start: still refused
  await new Promise((r) => setTimeout(r, 500));
  const withheldAfterRestart = await call("cv-fhir", "dispatch_outbound");
  const inAfter = (await evidence("carebrief", "message-in")).length;
  check(
    "H.5",
    "revocation needs grant ownership: another patient's authentic revocation of this grant is refused at both servers; the patient's own is accepted. A searchset QUEUED under the grant is refused at dispatch (condition-failed) and never reaches the patient agent — also after a resource-service PROCESS restart; the operator list withholds its envelope",
    [
      [crossAuth.revoked, crossFhir.revoked, /another patient/.test(crossFhir.reason ?? "")],
      [atAuth.revoked, atFhir.revoked],
      withheld.failed?.map((f) => [f.kind, f.status, f.reason]),
      [listed?.status, typeof listed?.withheld, listed?.envelope === undefined],
      withheldAfterRestart.failed?.map((f) => [f.kind, f.status, f.reason]),
      inAfter - inBefore,
      inBefore > 0 && inAfter < 100, // the count is inside the evidence window (meaningful)
    ],
    [
      [false, false, true],
      [true, true],
      [["deliver", "refused", "condition-failed"]],
      ["blocked", "string", true],
      [["deliver", "refused", "condition-failed"]],
      0,
      true,
    ],
  );

  const afterRestart = await read("Patient");
  const noahStill = await read("Patient", h.CV_FHIR.actor, undefined, "carebrief-noah");
  check(
    "H.6",
    "after the restart the revoked grant is refused for new reads; the other patient's grant is untouched",
    [afterRestart, noahStill],
    ["refused:grant-revoked", "completed:delivered"],
  );

  await disconnect("carebrief");
  await connect("carebrief", a2aFlags);
  const again = await call("carebrief", "summarise", {});
  check(
    "H.7",
    "patient-agent process restart: grant, validated resources and summaries persist (re-summarising gives the same cited statements)",
    [
      JSON.stringify(again.statements) === JSON.stringify(summary.statements),
      (await call("carebrief", "get_status")).domain.summaries,
    ],
    [true, 2],
  );

  for (const n of All) await disconnect(n);
  const fhirAudit = readFileSync(join(dir, "cv-fhir", "ledger.jsonl"), "utf8");
  const gov = [];
  for (const n of All) {
    const g = await cli(["governance", "--name", n]);
    const v = await cli(["verify-ledger", "--name", n]);
    gov.push([g.code, v.json.ok === true]);
  }
  check(
    "H.8",
    "after shutdown: the resource service's audit holds no clinical payload; revocations persisted with their ownership facts; every file registered; ledgers verify",
    [
      /lisinopril|penicillin|atorvastatin|Systolic|metformin/i.test(fhirAudit),
      JSON.parse(readFileSync(join(dir, "cv-fhir", "revocations.json"), "utf8")).revoked.map(
        (r) => [r.patient, r.patientId],
      ),
      gov,
    ],
    [false, [[h.CAREBRIEF.party, h.PATIENT_ID]], gov.map(() => [0, true])],
  );
}

// ================================================================== Part I — industrial
async function partI() {
  const f = await dist("fixtures/industrial.js");
  const d = await dist("domains/industrial.js");
  const { digestOf, newUrn } = await dist("core/canonical.js");
  const { signStatement, TYP } = await dist("mechanisms/statements.js");
  const { readAgent } = await dist("setup.js");
  const { CONFIG_ED25519 } = await dist("profile/configurations.js");
  const { PILOT_PROFILE, PURPOSE } = await dist("profile/vocabulary.js");
  const a2aFlags = ["--a2a"]; // manual dispatch: the harness captures every envelope it carries
  const N = [
    "alpine-planner",
    "alpine-authority",
    "orbis-telemetry",
    "orbis-legacy",
    "nordwerk-contracting",
    "nordwerk-diagnostic",
  ];

  const syn = await cli(["synthetic-industrial", "--out", join(work, "industrial-inputs")]);
  const ids = {};
  ids["alpine-planner"] = await provision(
    "alpine-planner",
    ["--role", "industrial-planner", "--owner-name", "alpine"],
    "a2a",
  );
  ids["alpine-authority"] = await provision(
    "alpine-authority",
    ["--role", "industrial-authority", "--owner-name", "alpine"],
    "a2a",
  );
  const alpineIssuer = join(work, "alpine-issuer.json");
  writeFileSync(alpineIssuer, (await cli(["issuer-card", "--name", "alpine-authority"])).stdout);
  for (const [p, model] of [
    [f.ORBIS_TP, "current"],
    [f.ORBIS_LEGACY, "old"],
  ])
    ids[p.name] = await provision(
      p.name,
      [
        "--role",
        "industrial-provider",
        "--party",
        p.party,
        "--actor",
        p.actor,
        "--role-input",
        `issuers=${syn.json.programmeIssuer},${alpineIssuer}`,
        "--role-input",
        `model=${model}`,
        "--owner-name",
        "orbis",
      ],
      "a2a",
    );
  ids["nordwerk-contracting"] = await provision(
    "nordwerk-contracting",
    [
      "--role",
      "industrial-contracting",
      "--role-input",
      `membership=${syn.json.membership}`,
      "--owner-name",
      "nordwerk",
    ],
    "a2a",
  );
  ids["nordwerk-diagnostic"] = await provision(
    "nordwerk-diagnostic",
    ["--role", "industrial-diagnostic", "--owner-name", "nordwerk"],
    "a2a",
  );
  for (const [a, b] of [
    ["alpine-planner", "alpine-authority"],
    ["alpine-planner", "nordwerk-diagnostic"],
    ["nordwerk-contracting", "orbis-telemetry"],
    ["nordwerk-contracting", "orbis-legacy"],
    ["nordwerk-diagnostic", "orbis-telemetry"],
    ["nordwerk-diagnostic", "nordwerk-contracting"],
  ]) {
    await pinCard(ids, a, b);
    await pinCard(ids, b, a);
    await pinA2a(a, b);
    await pinA2a(b, a);
  }
  const roles = (await cli(["roles"])).json.filter((r) => r.id.startsWith("industrial-"));
  check(
    "I.0",
    "one owner key per ORGANISATION (shared by its agents, kept in the owner directory), independent actor keys; Alpine's authorisation issuer key is separate; the programme issuer's private key was discarded",
    [
      ["alpine", "orbis", "nordwerk"].map((o) =>
        existsSync(join(OWNERS, o, "owner.private.jwk.json")),
      ),
      N.map((n) => existsSync(join(dir, n, "keys", "owner.private.jwk.json"))),
      [
        ids["alpine-planner"].partyKid === ids["alpine-authority"].partyKid,
        ids["nordwerk-contracting"].partyKid === ids["nordwerk-diagnostic"].partyKid,
        ids["orbis-telemetry"].partyKid === ids["orbis-legacy"].partyKid,
      ],
      new Set(N.map((n) => ids[n].actorKid)).size,
      ids["alpine-authority"].issuerKid !== ids["alpine-authority"].partyKid,
      /"d"\s*:/.test(readFileSync(syn.json.programmeIssuer, "utf8")),
    ],
    [[true, true, true], N.map(() => false), [true, true, true], 6, true, false],
  );

  for (const n of N) await connect(n, a2aFlags);
  const carried = [];
  /** Carry every queued envelope over A2A (dispatch_outbound) until all outboxes are empty. */
  const pumpAll = async () => {
    for (let round = 0; round < 12; round++) {
      let moved = 0;
      for (const n of N) {
        const { outbound = [] } = await call(n, "list_outbound");
        if (outbound.length === 0) continue;
        carried.push(...outbound.map((o) => ({ ...o, fromName: n })));
        await call(n, "dispatch_outbound");
        moved += outbound.length;
      }
      if (moved === 0) return;
    }
  };
  const phaseOf = async (n, conversation) => {
    const c = (await call(n, "get_status")).conversations.find((x) => x.id === conversation);
    return c ? `${c.phase}${c.closedReason ? `:${c.closedReason.split(":")[0]}` : ""}` : "absent";
  };
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
  const extra = async (n) => (await tools(n)).filter((t) => !generic.includes(t));
  check(
    "I.1",
    "exact per-role tools; the five industrial roles are discoverable with synthetic labels (`roles`)",
    [
      await extra("alpine-planner"),
      await extra("alpine-authority"),
      await extra("orbis-telemetry"),
      await extra("nordwerk-contracting"),
      await extra("nordwerk-diagnostic"),
      roles.map((r) => [r.id, r.synthetic]),
    ],
    [
      ["export_authorisation", "record_performance", "request_authorisation"],
      [],
      [],
      ["negotiate_offer", "request_transfer"],
      ["read_dataset", "recommend"],
      [
        "industrial-planner",
        "industrial-authority",
        "industrial-provider",
        "industrial-contracting",
        "industrial-diagnostic",
      ].map((id) => [id, true]),
    ],
  );

  // Internal delegation at Alpine.
  const cheap = await call("alpine-planner", "request_authorisation", {
    authorityActor: f.AUTHORITY.actor,
    recipient: f.CHEAPFIX,
  });
  await pumpAll();
  const ok = await call("alpine-planner", "request_authorisation", {
    authorityActor: f.AUTHORITY.actor,
    recipient: f.NORDWERK,
  });
  await pumpAll();
  const tpa = await call("alpine-planner", "export_authorisation");
  check(
    "I.2",
    "internal delegation at Alpine: the data authority refuses an authorisation for a recipient outside its mandate and issues one for NordWerk; `requestedBy` is the VERIFIED requesting agent",
    [
      await phaseOf("alpine-planner", cheap.step.conversation),
      await phaseOf("alpine-planner", ok.step.conversation),
      tpa.payload?.requestedBy,
      tpa.payload?.recipient,
    ],
    ["refused:not-authorised", "completed:delivered", f.PLANNER.actor, f.NORDWERK],
  );

  // Incompatible model version at the legacy endpoint.
  const legacy = await call("nordwerk-contracting", "negotiate_offer", {
    providerActor: f.ORBIS_LEGACY.actor,
    authorisation: tpa.authorisation,
    purpose: "maintenance",
  });
  await pumpAll();
  check(
    "I.3",
    "incompatible model version (legacy endpoint offers 1.1) is isolated before any proposal: the legacy endpoint saw only a describe and NordWerk's unsupported notice, and holds no agreement",
    [
      await phaseOf("nordwerk-contracting", legacy.step.conversation),
      (await evidence("orbis-legacy", "message-in")).map((m) => m.kind),
      (await evidence("orbis-legacy", "agreement")).length,
    ],
    ["unsupported:unsupported-term", ["describe", "unsupported"], 0],
  );

  // Forged messages (TEST HARNESS: signed with the agents' REAL actor keys, bypassing their
  // runtimes — a buggy or compromised client) delivered at the provider's boundary.
  const membership = JSON.parse(readFileSync(syn.json.membership, "utf8")).credential;
  const terms = (purpose) => ({
    model: d.EQUIPMENT_HEALTH.id,
    modelVersion: d.EQUIPMENT_HEALTH.version,
    offerId: d.OFFER_ID,
    asset: d.ASSET,
    window: tpa.payload.window,
    purpose,
    recipient: f.NORDWERK,
    retentionDays: 30,
    noRedistribution: true,
    thirdPartyAuthorisation: tpa.payload.id,
    synthetic: true,
  });
  const forge = async (name, who, kind, body, evidenceItems) => {
    const agent = await readAgent(dir, name);
    const at = new Date(NOW);
    const jws = await signStatement(agent.actorKey, TYP.message, {
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: newUrn(),
      conversation: newUrn(),
      kind,
      from: { actor: who.actor, onBehalfOf: who.party, operator: who.party },
      to: { actor: f.ORBIS_TP.actor, party: f.ORBIS },
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + 600_000).toISOString(),
      body,
      evidence: [
        ...evidenceItems.map((e) => ({ ...e, format: "jws-compact" })),
        { role: "representation", format: "jws-compact", value: agent.representationJws },
      ],
    });
    return call("orbis-telemetry", "deliver_inbound", {
      format: "envelope",
      data: JSON.stringify({ format: "awp-jws-compact/0.1", jws }),
    });
  };
  const byDiag = await forge(
    "nordwerk-diagnostic",
    f.NW_DIAG,
    "propose",
    {
      operation: d.DATA_OFFER_OP,
      terms: terms(PURPOSE.maintenance),
      termsDigest: digestOf(terms(PURPOSE.maintenance)),
      round: 1,
    },
    [
      { role: "membership", value: membership },
      { role: "authorisation", value: tpa.authorisation },
    ],
  );
  await pumpAll();
  check(
    "I.4",
    "membership is not internal authority: NordWerk's diagnostic agent (valid NordWerk credential, over-broad LOCAL mandate) proposing to contract is refused at Orbis — NordWerk's signed representation does not cover contracting",
    [
      byDiag.outbound?.map((o) => o.kind),
      (await evidence("orbis-telemetry", "representation-assessment"))
        .filter((r) => r.actor === f.NW_DIAG.actor)
        .map((r) => [r.outcome, r.reason]),
    ],
    [["refuse"], [["not-accepted", "representation-out-of-scope"]]],
  );

  const rnd = await call("nordwerk-contracting", "negotiate_offer", {
    providerActor: f.ORBIS_TP.actor,
    authorisation: tpa.authorisation,
    purpose: "product-development",
  });
  await pumpAll();
  check(
    "I.5",
    "a purpose other than the user's authorisation is refused by the holder",
    await phaseOf("nordwerk-contracting", rnd.step.conversation),
    "refused:purpose-not-permitted",
  );

  const forced = await forge(
    "nordwerk-contracting",
    f.NW_CONTRACT,
    "invoke",
    {
      operation: d.TRANSFER_OP,
      input: { dataset: "vibration-temperature" },
      basis: { kind: "agreement", agreement: "urn:awp:agreement:not-formed" },
    },
    [],
  );
  await pumpAll();
  const localEarly = await call("nordwerk-contracting", "request_transfer", {
    conversation: rnd.step.conversation,
  });
  check(
    "I.6",
    "no transfer before agreement: refused at the holder's boundary (forged invoke) and locally (request_transfer on a refused conversation); nothing transferred",
    [
      forced.outbound?.map((o) => o.kind),
      forced.step?.reason,
      /needs an agreed offer/.test(localEarly.error ?? ""),
      (await evidence("orbis-telemetry", "transfer")).length,
    ],
    [["refuse"], "no-agreement", true, 0],
  );

  const good = await call("nordwerk-contracting", "negotiate_offer", {
    providerActor: f.ORBIS_TP.actor,
    authorisation: tpa.authorisation,
    purpose: "maintenance",
  });
  await pumpAll();
  const conv = good.step.conversation;
  const nwAgreements = (await evidence("nordwerk-contracting", "agreement")).filter(
    (a) => a.conversation === conv,
  );
  const orbisAgreements = (await evidence("orbis-telemetry", "agreement")).filter(
    (a) => a.conversation === conv,
  );
  check(
    "I.7",
    "the represented contracting agent forms ONE agreement on the exact terms (same id and terms digest on both sides); agreement is not transfer",
    [
      await phaseOf("nordwerk-contracting", conv),
      nwAgreements.length,
      orbisAgreements.length,
      nwAgreements[0]?.id === orbisAgreements[0]?.id,
      nwAgreements[0]?.termsDigest === orbisAgreements[0]?.termsDigest,
      (await evidence("orbis-telemetry", "transfer")).length,
    ],
    ["agreed", 1, 1, true, true, 0],
  );

  await call("nordwerk-contracting", "request_transfer", { conversation: conv });
  await pumpAll();
  const nwStatus = await call("nordwerk-contracting", "get_status");
  const dataset = nwStatus.domain?.dataStore?.[0]?.id;
  check(
    "I.8",
    "permitted transfer under the agreement: Orbis records ONE transfer; NordWerk stores the dataset under the usage policy derived from the agreement; the source (Orbis) is authoritative under NordWerk's rule",
    [
      await phaseOf("nordwerk-contracting", conv),
      (await evidence("orbis-telemetry", "transfer")).map((t) => [t.dataset, t.repeat]),
      nwStatus.domain?.dataStore?.map((i) => [i.id, i.grant]),
      (await evidence("nordwerk-contracting", "source-authority")).map((s) => s.outcome),
    ],
    [
      "completed",
      [[dataset, false]],
      [[dataset, `${nwAgreements[0]?.id}#usage-policy`]],
      ["accepted"],
    ],
  );

  // Restart holder and recipient; replay the carried transfer request at the holder.
  await disconnect("orbis-telemetry");
  await disconnect("nordwerk-contracting");
  await connect("orbis-telemetry", a2aFlags);
  await connect("nordwerk-contracting", a2aFlags);
  const invoke = carried.find((o) => o.kind === "invoke" && o.fromName === "nordwerk-contracting");
  const replay = await call("orbis-telemetry", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(invoke.envelope),
  });
  await pumpAll();
  check(
    "I.9",
    "after both processes restart: a replayed transfer request is a duplicate; still one transfer and one stored dataset",
    [
      replay.step?.disposition,
      (await evidence("orbis-telemetry", "transfer")).length,
      (await call("nordwerk-contracting", "get_status")).domain?.dataStore?.length,
    ],
    ["duplicate", 1, 1],
  );

  const denied = await call("nordwerk-diagnostic", "read_dataset", {
    contractingActor: f.NW_CONTRACT.actor,
    dataset,
    purpose: "product-development",
  });
  await pumpAll();
  const read = await call("nordwerk-diagnostic", "read_dataset", {
    contractingActor: f.NW_CONTRACT.actor,
    dataset,
    purpose: "maintenance",
  });
  await pumpAll();
  await disconnect("nordwerk-contracting");
  const storeLog = readFileSync(
    join(dir, "nordwerk-contracting", "nordwerk-data-store-ledger.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).record)
    .filter((r) => r.type === "access-decision")
    .map((r) => [r.agent, r.purpose, r.decision]);
  await connect("nordwerk-contracting", a2aFlags);
  check(
    "I.10",
    "internal read at NordWerk's enforcement point: the requesting agent is the VERIFIED signer (no agent parameter exists); product-development refused, maintenance released",
    [
      await phaseOf("nordwerk-diagnostic", denied.step.conversation),
      await phaseOf("nordwerk-diagnostic", read.step.conversation),
      storeLog,
    ],
    [
      "refused:not-authorised",
      "completed:delivered",
      [
        [f.NW_DIAG.actor, PURPOSE.productDevelopment, "deny"],
        [f.NW_DIAG.actor, PURPOSE.maintenance, "permit"],
      ],
    ],
  );

  const rec = await call("nordwerk-diagnostic", "recommend", { plannerActor: f.PLANNER.actor });
  await pumpAll();
  const ordersAfterAccept = (await call("alpine-planner", "get_status")).domain?.workOrders;
  await disconnect("alpine-planner");
  await connect("alpine-planner", a2aFlags);
  const proposal = carried
    .filter((o) => o.kind === "propose" && o.fromName === "nordwerk-diagnostic")
    .at(-1);
  const replayRec = await call("alpine-planner", "deliver_inbound", {
    format: "envelope",
    data: JSON.stringify(proposal.envelope),
  });
  const perf1 = await call("alpine-planner", "record_performance", { workOrder: "WO-1" });
  const perf2 = await call("alpine-planner", "record_performance", { workOrder: "WO-1" });
  check(
    "I.11",
    "a derived recommendation (modelled assertion) is accepted and creates ONE synthetic work order; after a planner restart a replayed recommendation is a duplicate (no second order); performance is recorded separately and once",
    [
      await phaseOf("alpine-planner", rec.step.conversation),
      Object.values(ordersAfterAccept ?? {}),
      replayRec.step?.disposition,
      Object.keys((await call("alpine-planner", "get_status")).domain?.workOrders ?? {}).length,
      [perf1.recorded, perf2.recorded],
    ],
    ["completed", [{ id: "WO-1", status: "open" }], "duplicate", 1, [true, false]],
  );

  for (const n of N) await disconnect(n);
  const types = (n) =>
    readFileSync(join(dir, n, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).record.type);
  const gov = [];
  for (const n of N) {
    const g = await cli(["governance", "--name", n]);
    const v = await cli(["verify-ledger", "--name", n]);
    gov.push([g.code, v.json.ok === true]);
  }
  check(
    "I.12",
    "after shutdown: agreement, transfer and performance are DISTINCT events in distinct ledgers; every file registered; ledgers verify",
    [
      ["agreement", "transfer", "performance-observation"].map((t) =>
        types("orbis-telemetry").includes(t),
      ),
      ["agreement", "transfer", "performance-observation"].map((t) =>
        types("alpine-planner").includes(t),
      ),
      gov,
    ],
    [[true, true, false], [true, false, true], N.map(() => [0, true])],
  );
}

let exitCode = 1;
const parts = {};
try {
  if (ONLY.includes("E")) parts.E = await partE();
  if (ONLY.includes("H")) parts.H = await partH();
  if (ONLY.includes("I")) parts.I = await partI();
  exitCode = checks.length > 0 && checks.every((c) => c.pass) ? 0 : 1;
} catch (error) {
  console.error(error);
  checks.push({
    id: "harness",
    claim: "harness ran to completion",
    pass: false,
    error: String(error?.stack ?? error),
  });
} finally {
  for (const n of [...clients.keys()]) await disconnect(n).catch(() => undefined);
  const report = {
    generatedAt: new Date().toISOString(),
    synthetic: true,
    clock: NOW,
    parts: ONLY,
    labels: {
      tested:
        "independent OS processes on this host; MCP stdio operator; loopback carriages (public-http for anonymous public access, A2A for represented peers); real SPARQ policy decisions",
      local: "all listeners on 127.0.0.1; no external calls",
      synthetic:
        "every organisation, person, tariff, clinical record, telemetry sample and outcome is synthetic",
      notClaimed:
        "CDS/CDR conformance, SMART-on-FHIR/OAuth interoperability, HIPAA or clinical compliance or advice, Catena-X/DSP certification, Data Act legal eligibility, independent-vendor interoperability",
      providerSetupRequired:
        "live Gmail (account pair unanswered), hosted deployment, real accounts",
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
