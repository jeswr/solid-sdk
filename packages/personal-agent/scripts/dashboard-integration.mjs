#!/usr/bin/env node
// Dashboard workflow (SYNTHETIC ONLY, temporary state, bounded, cleaned up). Requires `npm run build`
// and a local SPARQ policy binary.
//
//  1. `awp-dashboard demo-setup` in a NEW temporary state directory (two new demo agents);
//  2. `awp-dashboard serve` on a free loopback port; the one-time link is read from its stdout;
//  3. security checks over raw HTTP: Host (DNS rebinding), Origin, session bootstrap (single use),
//     CSRF, CSP and headers, no CORS, static allowlist, body limit, sanitised errors;
//  4. calendar settings: preview (same scheduling code) changes with the chosen calendars; an
//     unavailable authoritative calendar blocks; stale revisions conflict; apply to the agent;
//  5. the agent CONSUMES the applied availability: the demo agents negotiate over MCP (separate
//     OS processes, official SDK) — a day the owner's chosen calendars make busy is refused, a free
//     day is booked outside the busy periods, and a blocked configuration refuses everything;
//  6. cleanup (processes stopped, temporary directory removed) in `finally`.
// No provider, no network beyond 127.0.0.1, no hosted triage (TYPESAFE_API_KEY is removed).
//
// Usage: node scripts/dashboard-integration.mjs --sparq-bin=PATH [--out=reports/dashboard-integration-report.json]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const DASH = join(root, "dist", "dashboard", "cli.js");
const PILOT = join(root, "dist", "pilot", "cli.js");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "dashboard-integration-report.json");
const SPARQ_BIN = flag("sparq-bin") ?? process.env.AWP_SPARQ_POLICY_BIN;
const NOW = "2026-10-19T08:00:00Z"; // Monday; London is UTC+1 until 25 October
const DEADLINE_MS = 180_000;
if (!existsSync(DASH) || !existsSync(PILOT)) {
  console.error("build first: npm run build");
  process.exit(2);
}
if (!SPARQ_BIN || !existsSync(SPARQ_BIN)) {
  console.error("setup-required: pass --sparq-bin=PATH to a built sparq-policy-decide");
  process.exit(3);
}

const work = mkdtempSync(join(tmpdir(), "awp-dashboard-"));
const stateDir = join(work, "state");
const agentsDir = join(stateDir, "demo-agents");
const checks = [];
const traces = {};
const clients = new Map();
let serve;
const env = { ...process.env };
delete env.TYPESAFE_API_KEY;
delete env.TYPESAFE_MODEL;

const deadline = setTimeout(() => {
  console.error(`dashboard integration exceeded ${DEADLINE_MS / 1000}s; stopping`);
  cleanup().finally(() => process.exit(4));
}, DEADLINE_MS);

function check(id, claim, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ id, claim, expected, actual, pass });
  if (!pass)
    console.error(
      `FAIL ${id}: ${claim}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
}

function run(cli, args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => done({ code, stdout, stderr }));
  });
}

function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

let Port;
let cookie = "";
let csrf = "";
/** Raw HTTP to the dashboard (full control over Host/Origin/headers). */
function http(method, path, { headers = {}, body, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: Port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${Port}`,
          ...(payload !== undefined
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
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", fail);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
const ORIGIN = () => `http://127.0.0.1:${Port}`;
const authed = (method, path, body, extra = {}) =>
  http(method, path, {
    body,
    headers: {
      cookie,
      ...(method === "GET" ? {} : { origin: ORIGIN(), "x-csrf-token": csrf }),
      ...extra,
    },
  });

async function startServe() {
  serve = spawn(
    process.execPath,
    [DASH, "serve", "--state", stateDir, "--port", String(Port), "--now", NOW],
    { stdio: ["pipe", "pipe", "pipe"], env },
  );
  let out = "";
  serve.stderr.on("data", () => undefined);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("serve did not print a link")), 15_000);
    serve.stdout.on("data", (d) => {
      out += d;
      const m = /#code=([A-Za-z0-9_-]+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        done(m[1]);
      }
    });
    serve.on("exit", (code) => fail(new Error(`serve exited early (${code})`)));
  });
}

function nextLink() {
  return new Promise((done) => {
    const onData = (d) => {
      const m = /#code=([A-Za-z0-9_-]+)/.exec(String(d));
      if (m) {
        serve.stdout.off("data", onData);
        done(m[1]);
      }
    };
    serve.stdout.on("data", onData);
    serve.stdin.write("\n");
  });
}

// ---- MCP (the agents' own runtime) ----
async function connect(name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [PILOT, "mcp", "--name", name, "--dir", agentsDir, "--now", NOW],
    stderr: "pipe",
    env,
  });
  transport.stderr?.on("data", () => undefined);
  const client = new Client({ name: "awp-dashboard-integration", version: "0.1.0" });
  await client.connect(transport);
  clients.set(name, { client, transport });
}
async function disconnect(name) {
  const entry = clients.get(name);
  if (!entry) return;
  clients.delete(name);
  await entry.client.close();
}
async function call(name, tool, args = {}) {
  const r = await clients.get(name).client.callTool({ name: tool, arguments: args });
  if (r.isError) return { error: r.content?.[0]?.text ?? "error" };
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
}
const ACTORS = {
  "https://agents.owner.example/personal#agent": "demo-owner",
  "https://agents.peer.example/personal#agent": "demo-peer",
};
async function shuttle() {
  const trace = [];
  for (let round = 0; round < 20; round++) {
    let moved = 0;
    for (const from of ["demo-peer", "demo-owner"]) {
      const { outbound = [] } = await call(from, "list_outbound");
      for (const item of outbound) {
        const to = ACTORS[item.toActor];
        if (!to || !clients.has(to)) continue;
        const r = await call(to, "deliver_inbound", {
          format: "envelope",
          data: JSON.stringify(item.envelope),
        });
        trace.push(`${from}>${item.kind}:${r.step?.disposition ?? r.error ?? "?"}`);
        await call(from, "ack_outbound", { ids: [item.id] });
        moved++;
      }
    }
    if (moved === 0) break;
  }
  return trace;
}
async function negotiate(windowStart, windowEnd, title) {
  const before = Object.keys((await call("demo-owner", "get_status")).holds ?? {}).length;
  await call("demo-peer", "propose_meeting", {
    peerActor: "https://agents.owner.example/personal#agent",
    windowStart,
    windowEnd,
    durationMinutes: 30,
    title,
  });
  const trace = await shuttle();
  traces[title] = trace;
  const status = await call("demo-owner", "get_status");
  const holds = Object.values(status.holds ?? {});
  return { trace, newHolds: holds.length - before, holds };
}
const overlaps = (a, b) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

async function cleanup() {
  for (const name of [...clients.keys()]) await disconnect(name).catch(() => undefined);
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

let fatal;
try {
  // ---- 1. demo setup (new, temporary; never the prepared Alice/Bob pair) ----
  const setup = await run(DASH, [
    "demo-setup",
    "--state",
    stateDir,
    `--sparq-bin=${resolve(SPARQ_BIN)}`,
    "--now",
    NOW,
  ]);
  const setupJson = setup.code === 0 ? JSON.parse(setup.stdout) : {};
  check(
    "D.1",
    "demo-setup creates two new synthetic agents in the dashboard's own directory and applies ready availability",
    [setup.code, setupJson.agents, setupJson.availabilityApplied?.blocked],
    [0, ["demo-owner", "demo-peer"], null],
  );
  const mode = (p) => (statSync(p).mode & 0o777).toString(8);
  check(
    "D.2",
    "private modes: state and owner-key directories 0700, settings 0600",
    [
      mode(stateDir),
      mode(join(stateDir, "demo-owner-keys")),
      mode(join(stateDir, "settings.json")),
    ],
    ["700", "700", "600"],
  );
  const again = await run(DASH, [
    "demo-setup",
    "--state",
    stateDir,
    `--sparq-bin=${resolve(SPARQ_BIN)}`,
  ]);
  check("D.3", "demo-setup refuses to run twice (nothing overwritten)", again.code, 1);

  // ---- 2. serve ----
  Port = await freePort();
  const code = await startServe();

  // ---- 3. security ----
  const rebinding = await http("GET", "/", { headers: { host: `attacker.example:${Port}` } });
  const rebindingApi = await http("POST", "/api/session", {
    headers: { host: `attacker.example:${Port}`, origin: `http://attacker.example:${Port}` },
    body: { code },
  });
  check(
    "S.1",
    "a foreign Host (DNS rebinding) is refused for pages and the API",
    [rebinding.status, rebindingApi.status],
    [421, 421],
  );
  const page = await http("GET", "/");
  const csp = page.headers["content-security-policy"] ?? "";
  check(
    "S.2",
    "the page is served with a strict CSP (self only, no inline/eval, no framing), nosniff, no-referrer and no CORS",
    [
      page.status,
      csp.includes("script-src 'self'") && !csp.includes("unsafe"),
      csp.includes("frame-ancestors 'none'"),
      page.headers["x-content-type-options"],
      page.headers["referrer-policy"],
      page.headers["access-control-allow-origin"] ?? null,
      /<script src="\/assets\/app\.js" type="module"><\/script>/.test(page.text) &&
        !/<script>/.test(page.text),
    ],
    [200, true, true, "nosniff", "no-referrer", null, true],
  );
  const unauth = await http("GET", "/api/overview");
  check(
    "S.3",
    "the private API needs a session (localhost is not authentication)",
    unauth.status,
    401,
  );
  const crossOrigin = await http("POST", "/api/session", {
    headers: { origin: "http://evil.example" },
    body: { code },
  });
  const noOrigin = await http("POST", "/api/session", { body: { code } });
  const crossSite = await http("POST", "/api/session", {
    headers: { origin: ORIGIN(), "sec-fetch-site": "cross-site" },
    body: { code },
  });
  const wrongCode = await http("POST", "/api/session", {
    headers: { origin: ORIGIN() },
    body: { code: "x".repeat(43) },
  });
  check(
    "S.4",
    "session bootstrap refuses cross-origin, origin-less, cross-site and wrong-code attempts",
    [crossOrigin.status, noOrigin.status, crossSite.status, wrongCode.status],
    [403, 403, 403, 401],
  );
  // A wrong code does not consume the real one only while under the failure limit: use it now.
  const session = await http("POST", "/api/session", {
    headers: { origin: ORIGIN() },
    body: { code },
  });
  const setCookie = String(session.headers["set-cookie"] ?? "");
  cookie = setCookie.split(";")[0];
  csrf = session.json?.csrf ?? "";
  const reuse = await http("POST", "/api/session", {
    headers: { origin: ORIGIN() },
    body: { code },
  });
  check(
    "S.5",
    "the one-time code gives an HttpOnly SameSite=Strict session once; reuse is refused",
    [
      session.status,
      /HttpOnly/.test(setCookie),
      /SameSite=Strict/.test(setCookie),
      csrf.length > 20,
      reuse.status,
    ],
    [200, true, true, true, 401],
  );
  const fresh = await nextLink();
  check(
    "S.6",
    "pressing Enter in the terminal prints a new one-time link",
    fresh !== code && fresh.length > 20,
    true,
  );

  const overview = await authed("GET", "/api/overview");
  const rev = overview.json.revision;
  const noCsrf = await http("PUT", "/api/triage", {
    headers: { cookie, origin: ORIGIN() },
    body: { baseRevision: rev, hostedEnabled: true },
  });
  const badCsrf = await authed(
    "PUT",
    "/api/triage",
    { baseRevision: rev, hostedEnabled: true },
    { "x-csrf-token": "forged" },
  );
  const formPost = await http("PUT", "/api/triage", {
    headers: {
      cookie,
      origin: ORIGIN(),
      "x-csrf-token": csrf,
      "content-type": "application/x-www-form-urlencoded",
    },
    raw: "baseRevision=1&hostedEnabled=true",
  });
  check(
    "S.7",
    "writes need the CSRF token and a JSON body",
    [noCsrf.status, badCsrf.status, formPost.status],
    [403, 403, 415],
  );
  const big = await authed("POST", "/api/connections", {
    baseRevision: rev,
    record: {
      label: "x",
      channel: "email",
      provider: "",
      organisation: "",
      identifiers: [],
      notes: "n".repeat(300_000),
    },
  });
  const extraField = await authed("PUT", "/api/triage", {
    baseRevision: rev,
    hostedEnabled: false,
    endpoint: "https://evil.example",
  });
  check(
    "S.8",
    "request bodies are capped and DTOs are allowlisted (unknown fields such as an inference URL are refused)",
    [big.status, extraField.status],
    [413, 400],
  );
  const probes = await Promise.all(
    [
      "/package.json",
      "/settings.json",
      "/assets/../package.json",
      "/assets/%2e%2e/%2e%2e/package.json",
      "/demo-agents/demo-owner/identity.json",
      "/demo-owner-keys/",
      "/assets/app.js.map",
      "/api/../settings.json",
    ].map((p) => http("GET", p, { headers: { cookie } })),
  );
  check(
    "S.9",
    "only the allowlisted assets are served: no repository, state, agent or key files",
    probes.map((r) => r.status),
    [404, 404, 404, 404, 404, 404, 404, 404],
  );
  const apiHeaders = await authed("GET", "/api/triage");
  check(
    "S.10",
    "API responses are no-store, never CORS-enabled; hosted triage is not configured and no key material appears",
    [
      apiHeaders.headers["cache-control"],
      apiHeaders.headers["access-control-allow-origin"] ?? null,
      apiHeaders.json.hosted.configured,
      /api[_-]?key|bearer/i.test(apiHeaders.text),
    ],
    ["no-store", null, false, false],
  );

  // Malicious label: stored and returned as data (the page renders it as text).
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const added = await authed("POST", "/api/connections", {
    baseRevision: rev,
    record: {
      label: evil,
      channel: "email",
      provider: "other",
      organisation: "",
      identifiers: [],
      notes: "",
    },
  });
  const conns = await authed("GET", "/api/connections");
  const stored = conns.json.connections.find((c) => c.id === added.json?.id);
  check(
    "S.11",
    "a hostile label is stored verbatim as JSON data with default-deny restrictions and 'setup required' (rendered as text by the page)",
    [
      added.status,
      stored?.label === evil,
      conns.headers["content-type"]?.startsWith("application/json"),
      stored?.status.state,
      stored?.restrictions.agentEnabled,
    ],
    [201, true, true, "setup-required", false],
  );
  // Triage over HTTP: account restrictions gate the local route too; hosted is never reached here.
  const sample = { subject: "Lunch?", body: "Could you let me know if Thursday works?" };
  const denied = await authed("POST", "/api/triage/classify", {
    sample,
    synthetic: true,
    accountId: "demo-mailbox",
    useHosted: false,
    consent: false,
  });
  const sandbox = await authed("POST", "/api/triage/classify", {
    sample,
    synthetic: true,
    useHosted: true,
    consent: true,
  });
  const notSynthetic = await authed("POST", "/api/triage/classify", {
    sample,
    useHosted: false,
    consent: false,
  });
  check(
    "T.1",
    "triage of a sample linked to an excluded account is refused; the unlinked sandbox uses local rules only (no key: hosted not allowed) and asks the owner; samples must be declared synthetic",
    [
      denied.status,
      sandbox.status,
      sandbox.json?.source,
      sandbox.json?.hosted.status,
      sandbox.json?.mayAct,
      sandbox.json?.askOwner.length > 0,
      notSynthetic.status,
    ],
    [403, 200, "deterministic-baseline", "not-allowed", false, true, 400],
  );
  const stale = await authed("PUT", "/api/triage", { baseRevision: rev, hostedEnabled: false });
  check(
    "S.12",
    "a write based on a stale revision is refused (409), not merged",
    [stale.status, stale.json?.revision],
    [409, rev + 1],
  );

  // ---- 4. calendars ----
  let cal = (await authed("GET", "/api/calendars")).json;
  check("C.1", "the demo calendars are ready", cal.evaluation.status, "ready");
  const tuesday = { start: "2026-10-20T08:00:00Z", end: "2026-10-20T16:00:00Z" };
  const preview = async (draft) =>
    (
      await authed("POST", "/api/calendars/preview", {
        window: tuesday,
        durationMinutes: 60,
        ...(draft ? { draft } : {}),
      })
    ).json;
  const withRota = await preview();
  const withoutRota = await preview({
    calendars: cal.calendars,
    availability: { ...cal.availability, authoritative: ["demo-agent-calendar"] },
  });
  const withExternal = await preview({
    calendars: cal.calendars,
    availability: {
      ...cal.availability,
      authoritative: [...cal.availability.authoritative, "demo-provider-calendar"],
    },
  });
  const rota = cal.calendars.find((c) => c.id === "demo-team-rota");
  check(
    "C.2",
    "the chosen calendars change the preview (same scheduling code): the team rota's busy morning is excluded only while it counts",
    [
      withRota.freeSlots.some((s) => rota.busy.some((b) => overlaps(s, b))),
      withoutRota.freeSlots.some((s) => rota.busy.some((b) => overlaps(s, b))),
      JSON.stringify(withRota.freeSlots) !== JSON.stringify(withoutRota.freeSlots),
    ],
    [false, true, true],
  );
  check(
    "C.3",
    "an unavailable (disabled, unconnected) authoritative calendar fails closed: blocked, no free time, the simulated offer refused",
    [withExternal.status, withExternal.freeSlots.length, withExternal.peerOffer.decision],
    ["blocked", 0, "refuse"],
  );
  // Make Thursday busy on the rota, save, apply.
  const thursdayBusy = { start: "2026-10-22T00:00:00Z", end: "2026-10-22T23:45:00Z" };
  const calendars = cal.calendars.map((c) =>
    c.id === "demo-team-rota" ? { ...c, busy: [...c.busy, thursdayBusy] } : c,
  );
  const saved = await authed("PUT", "/api/calendars", {
    baseRevision: cal.revision,
    calendars,
    availability: cal.availability,
  });
  const conflict = await authed("PUT", "/api/calendars", {
    baseRevision: cal.revision,
    calendars,
    availability: cal.availability,
  });
  const badRef = await authed("PUT", "/api/calendars", {
    baseRevision: saved.json.revision,
    calendars,
    availability: { ...cal.availability, bookingTarget: "no-such-calendar" },
  });
  check(
    "C.4",
    "saving calendar settings bumps the revision; a stale save conflicts; unknown references are refused",
    [saved.status, saved.json.evaluation.status, conflict.status, badRef.status],
    [200, "ready", 409, 400],
  );
  const applied = await authed("POST", "/api/calendars/apply", {
    baseRevision: saved.json.revision,
    agent: "demo-owner",
  });
  const notManaged = await authed("POST", "/api/calendars/apply", {
    baseRevision: applied.json.revision,
    agent: "demo-peer",
  });
  check(
    "C.5",
    "apply writes the availability for the managed agent only (the peer is not managed); applies at the agent's next start",
    [applied.status, applied.json.applied.blocked, applied.json.running, notManaged.status],
    [200, null, false, 400],
  );

  // ---- 5. the runtime consumes it ----
  await connect("demo-owner");
  await connect("demo-peer");
  const busyDay = await negotiate(
    "2026-10-22T08:00:00Z",
    "2026-10-22T16:00:00Z",
    "Synthetic check: rota day",
  );
  check(
    "R.1",
    "the owner's agent explicitly refuses a day its chosen calendars make busy (signed refusal, no hold)",
    [busyDay.newHolds, busyDay.trace.filter((t) => t.startsWith("demo-owner>")).at(-1)],
    [0, "demo-owner>refuse:accepted"],
  );
  const freeDay = await negotiate(
    "2026-10-20T08:00:00Z",
    "2026-10-20T16:00:00Z",
    "Synthetic check: free day",
  );
  const newest = freeDay.holds.at(-1);
  check(
    "R.2",
    "on a free day it books one synthetic hold, outside every busy period of the chosen calendars",
    [freeDay.newHolds, newest ? rota.busy.some((b) => overlaps(newest, b)) : null],
    [1, false],
  );
  // Blocked configuration: count the unavailable provider calendar, apply while running.
  cal = (await authed("GET", "/api/calendars")).json;
  const blockedSave = await authed("PUT", "/api/calendars", {
    baseRevision: cal.revision,
    calendars: cal.calendars,
    availability: {
      ...cal.availability,
      authoritative: [...cal.availability.authoritative, "demo-provider-calendar"],
    },
  });
  const blockedApply = await authed("POST", "/api/calendars/apply", {
    baseRevision: blockedSave.json.revision,
    agent: "demo-owner",
  });
  check(
    "R.3",
    "applying while the agent runs is reported (takes effect at next start); the applied settings are blocked",
    [
      blockedSave.json.evaluation.status,
      blockedApply.json.running,
      typeof blockedApply.json.applied.blocked,
    ],
    ["blocked", true, "string"],
  );
  const whileRunning = (await authed("GET", "/api/calendars")).json.managedAgents[0];
  await disconnect("demo-owner");
  await connect("demo-owner");
  const afterRestart = (await authed("GET", "/api/calendars")).json.managedAgents[0];
  check(
    "R.3b",
    "the page distinguishes applied-for-next-start from what the running agent uses: pending restart while it runs, in use after it restarts",
    [whileRunning.matchesSaved, whileRunning.availability.use, afterRestart.availability.use],
    [true, "pending-restart", "in-use"],
  );
  const blockedDay = await negotiate(
    "2026-10-23T08:00:00Z",
    "2026-10-23T16:00:00Z",
    "Synthetic check: blocked",
  );
  check(
    "R.4",
    "after restart the agent fails closed: an unavailable authoritative calendar means no time is offered or accepted",
    [blockedDay.newHolds, blockedDay.trace.filter((t) => t.startsWith("demo-owner>")).at(-1)],
    [0, "demo-owner>refuse:accepted"],
  );
  const history = (await authed("GET", "/api/history")).json.history;
  check(
    "H.1",
    "every change is in the bounded history with actor and time",
    [
      history.length >= 6,
      history.every((e) => e.actor && e.at && e.revision),
      [...new Set(history.map((e) => e.actor))].sort(),
    ],
    [true, true, ["demo setup", "owner (dashboard)"]],
  );
} catch (error) {
  fatal = String(error?.stack ?? error).slice(0, 2000);
  console.error(fatal);
} finally {
  await cleanup();
  clearTimeout(deadline);
}

const report = {
  report: "Owner dashboard — integration workflow (synthetic, temporary state)",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    clock: `fixed synthetic ${NOW}`,
    boundary:
      "dashboard served on 127.0.0.1 (free port) from a temporary state directory; demo agents are new and temporary; agents run as `awp-pilot mcp` stdio servers; no provider, no hosted triage (key removed from the environment)",
    cleanup: existsSync(work)
      ? "FAILED: temporary directory still present"
      : "temporary directory removed",
  },
  checks,
  traces,
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
