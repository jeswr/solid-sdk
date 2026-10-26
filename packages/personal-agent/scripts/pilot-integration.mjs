#!/usr/bin/env node
// Separate-process integration workflow for the pilot (SYNTHETIC ONLY). Requires `npm run build`.
//
// Every agent command runs as its own OS process (`node dist/pilot/cli.js ...`); the two
// personal agents run as long-running `serve` processes that only exchange files through
// spool directories. The harness plays the provider: it moves each reviewed Gmail
// `users.messages.send` body from one agent's outbox into the other's inbox as a
// `format=raw` message. The UC-02 provider is the local reference service running as a
// separate process on 127.0.0.1. Nothing leaves this machine; no credentials are used.
//
// Policy module: SPARQ by default (as for `awp-pilot init`); the binary comes from
// --sparq-bin or AWP_SPARQ_POLICY_BIN. Without one the run stops as setup-required (exit 3) —
// it never switches module. `--policy-engine=solid-odrl` selects the alternative explicitly.
//
// Usage: node scripts/pilot-integration.mjs [--out reports/pilot-integration-report.json]
//          [--policy-engine=sparq|solid-odrl] [--sparq-bin=PATH]
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(root, "dist", "pilot", "cli.js");
const SLOTS = join(root, "dist", "pilot", "domains", "conventional", "slots-server.js");
const outArg = process.argv.indexOf("--out");
const OUT =
  outArg > 0 ? process.argv[outArg + 1] : join(root, "reports", "pilot-integration-report.json");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ENGINE = flag("policy-engine") ?? "sparq";
const SPARQ_BIN = flag("sparq-bin") ?? process.env.AWP_SPARQ_POLICY_BIN;
if (ENGINE !== "sparq" && ENGINE !== "solid-odrl") {
  console.error(`unknown --policy-engine ${ENGINE}`);
  process.exit(64);
}
if (ENGINE === "sparq" && (!SPARQ_BIN || !existsSync(SPARQ_BIN))) {
  console.error(
    "setup-required: SPARQ is the default policy module; build sparq-policy-decide and pass " +
      "--sparq-bin=PATH (or AWP_SPARQ_POLICY_BIN), or choose --policy-engine=solid-odrl explicitly",
  );
  process.exit(3);
}
/** Arguments selecting the module on `init` and `demo` (the binary path is not logged). */
const POLICY_ARGS =
  ENGINE === "sparq"
    ? ["--policy-engine=sparq", `--sparq-bin=${resolve(SPARQ_BIN)}`]
    : ["--policy-engine=solid-odrl"];
const DEADLINE = Date.now() + 240_000;
const NOW = "2026-10-19T08:00:00Z";
const work = mkdtempSync(join(tmpdir(), "awp-integration-"));
const dir = join(work, "agents");
const steps = [];
const checks = [];
const live = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(CLI) || !existsSync(SLOTS)) {
  console.error("build first: npm run build");
  process.exit(2);
}

function check(id, claim, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ id, claim, expected, actual, pass });
  if (!pass)
    console.error(
      `FAIL ${id}: ${claim}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
}

function lastJson(text) {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const lines = t.split("\n").filter((l) => l.startsWith("{"));
    try {
      return JSON.parse(lines.at(-1) ?? "{}");
    } catch {
      return {};
    }
  }
}

/** Run one CLI command as a separate process, bounded by a timeout. */
function cli(args, { env = {}, timeoutMs = 30_000, label } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, ...args, "--dir", dir, "--now", NOW], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const step = {
        process: label ?? args[0],
        args: args.filter((a) => !a.includes("/")).slice(0, 6),
        pid: child.pid,
        exitCode: code,
        signal,
        ms: Date.now() - started,
      };
      steps.push(step);
      resolve({ ...step, stdout, stderr, json: lastJson(stdout) });
    });
  });
}

/** Start a long-running process and wait (bounded) for its JSON readiness line. */
function startService(command, args, { env = {}, label, readyTimeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    live.add(child);
    const lines = [];
    let buf = "";
    let stderr = "";
    const exited = new Promise((r) =>
      child.once("exit", (code, signal) => {
        live.delete(child);
        r({ code, signal });
      }),
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label}: not ready within ${readyTimeoutMs} ms: ${stderr}`));
    }, readyTimeoutMs);
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => {
      buf += d;
      let i = buf.indexOf("\n");
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const j = JSON.parse(line);
          lines.push(j);
          if (j.ready) {
            clearTimeout(timer);
            steps.push({
              process: label,
              event: "ready",
              pid: child.pid,
              ...(j.recovered !== undefined ? { recovered: j.recovered } : {}),
              ...(j.recoveredStaleLockFromPid
                ? { recoveredStaleLockFromPid: j.recoveredStaleLockFromPid }
                : {}),
            });
            resolve({ child, ready: j, lines, exited, stderr: () => stderr });
          }
        } catch {
          // non-JSON line
        }
        i = buf.indexOf("\n");
      }
    });
    exited.then(({ code, signal }) => {
      clearTimeout(timer);
      if (!lines.some((l) => l.ready))
        reject(new Error(`${label}: exited (${code ?? signal}) before ready: ${stderr}`));
    });
  });
}

/** Bounded shutdown: SIGTERM, then SIGKILL after 5 s. */
async function stop(svc, label) {
  if (svc.child.exitCode !== null || svc.child.signalCode !== null) return { already: true };
  svc.child.kill("SIGTERM");
  const res = await Promise.race([svc.exited, sleep(5_000).then(() => undefined)]);
  if (res) {
    steps.push({
      process: label,
      event: "stopped",
      pid: svc.child.pid,
      exitCode: res.code,
      signal: res.signal,
    });
    return res;
  }
  svc.child.kill("SIGKILL");
  const forced = await svc.exited;
  steps.push({ process: label, event: "killed-after-timeout", pid: svc.child.pid });
  return forced;
}

function files(d, suffix) {
  if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...files(p, suffix));
    else if (f.endsWith(suffix)) out.push(p);
  }
  return out;
}

let seq = 0;
/** The simulated provider: deliver each new send payload into the peer inbox. */
function pump(fromOutDirs, toIn, seen) {
  let moved = 0;
  for (const d of fromOutDirs) {
    for (const f of files(d, ".gmail-send.json").sort()) {
      if (seen.has(f)) continue;
      seen.add(f);
      const send = JSON.parse(readFileSync(f, "utf8"));
      writeFileSync(
        join(toIn, `${String(++seq).padStart(4, "0")}.gmail.json`),
        JSON.stringify({ id: `m${seq}`, threadId: "18c0ffee00000001", raw: send.raw }),
      );
      moved++;
    }
  }
  return moved;
}

async function personalWorkflow() {
  const A = {
    name: "alice",
    party: "https://alice.example/#me",
    actor: "https://agents.alice.example/personal#agent",
    email: "alice.awp@example.com",
  };
  const B = {
    name: "bob",
    party: "https://bob.example/#me",
    actor: "https://agents.hostco.example/bob#agent",
    email: "bob.awp@example.com",
  };
  const ia = await cli([
    "init",
    ...POLICY_ARGS,
    "--name",
    A.name,
    "--party",
    A.party,
    "--actor",
    A.actor,
    "--email",
    A.email,
    "--timezone",
    "Europe/London",
    "--known-party",
    B.party,
  ]);
  const ib = await cli([
    "init",
    ...POLICY_ARGS,
    "--name",
    B.name,
    "--party",
    B.party,
    "--actor",
    B.actor,
    "--operator",
    "https://hostco.example/#org",
    "--email",
    B.email,
    "--timezone",
    "America/New_York",
    "--known-party",
    A.party,
  ]);
  for (const [who, card] of [
    [A, ia.json],
    [B, ib.json],
  ]) {
    const c = await cli(["card", "--name", who.name]);
    writeFileSync(join(work, `${who.name}.card.json`), c.stdout);
    void card;
  }
  await cli([
    "pin",
    "--name",
    A.name,
    "--card",
    join(work, "bob.card.json"),
    `--party-kid=${ib.json.partyKid}`,
    `--actor-kid=${ib.json.actorKid}`,
  ]);
  await cli([
    "pin",
    "--name",
    B.name,
    "--card",
    join(work, "alice.card.json"),
    `--party-kid=${ia.json.partyKid}`,
    `--actor-kid=${ia.json.actorKid}`,
  ]);
  const spoolA = join(work, "spool-alice");
  const spoolB = join(work, "spool-bob");
  for (const s of [spoolA, spoolB])
    for (const sub of ["in", "out", "done", "rejected"])
      mkdirSync(join(s, sub), { recursive: true });
  const out0 = join(work, "alice-propose");
  const p = await cli([
    "propose-meeting",
    "--name",
    A.name,
    "--peer-actor",
    B.actor,
    "--peer-party",
    B.party,
    "--window-start",
    "2026-10-20T13:00:00Z",
    "--window-end",
    "2026-10-20T17:00:00Z",
    "--out",
    out0,
  ]);
  check("A.1", "proposal prepared by a separate process", p.exitCode, 0);

  // Bob is started with a synthetic fault: it SIGKILLs itself right after its calendar
  // hold commits (a crash between effect and conclusion).
  let bob = await startService(
    CLI,
    [
      "serve",
      "--name",
      B.name,
      "--spool",
      spoolB,
      "--interval-ms",
      "150",
      "--dir",
      dir,
      "--now",
      NOW,
    ],
    {
      env: { AWP_SYNTHETIC_FAULT: "calendar-kill-after-commit" },
      label: "serve bob (fault injected)",
    },
  );
  const alice = await startService(
    CLI,
    [
      "serve",
      "--name",
      A.name,
      "--spool",
      spoolA,
      "--interval-ms",
      "150",
      "--dir",
      dir,
      "--now",
      NOW,
    ],
    { label: "serve alice" },
  );
  const contention = await cli(
    ["serve", "--name", B.name, "--spool", join(work, "spool-contender"), "--once"],
    { label: "second serve bob (contender)" },
  );
  check(
    "A.2",
    "a second process for the same agent state is refused while the first is live",
    [contention.exitCode, /locked: .*held by live process/.test(contention.stderr)],
    [1, true],
  );

  const seenFiles = new Set();
  const firstToBob = [];
  let crashes = 0;
  let crashedPid;
  let quiet = 0;
  pump([out0], join(spoolB, "in"), seenFiles);
  firstToBob.push(
    ...readdirSync(join(spoolB, "in"))
      .map((f) => join(spoolB, "in", f))
      .map((f) => {
        const c = join(work, `copy-${f.split("/").at(-1)}`);
        copyFileSync(f, c);
        return c;
      }),
  );
  while (Date.now() < DEADLINE && quiet < 8) {
    await sleep(250);
    if (bob.child.exitCode !== null || bob.child.signalCode !== null) {
      const ex = await bob.exited;
      crashes++;
      crashedPid = bob.child.pid;
      steps.push({ process: "serve bob", event: "crashed", pid: bob.child.pid, signal: ex.signal });
      bob = await startService(
        CLI,
        [
          "serve",
          "--name",
          B.name,
          "--spool",
          spoolB,
          "--interval-ms",
          "150",
          "--dir",
          dir,
          "--now",
          NOW,
        ],
        { label: "serve bob (restarted, no fault)" },
      );
    }
    const moved =
      pump([join(spoolB, "out")], join(spoolA, "in"), seenFiles) +
      pump([join(spoolA, "out")], join(spoolB, "in"), seenFiles);
    const pending = readdirSync(join(spoolA, "in")).length + readdirSync(join(spoolB, "in")).length;
    quiet = moved === 0 && pending === 0 ? quiet + 1 : 0;
  }
  check(
    "A.3",
    "bob was SIGKILLed after its effect committed; the restarted process took over the dead holder's lock and re-emitted pending outbound work",
    [crashes, bob.ready.recoveredStaleLockFromPid === crashedPid, bob.ready.recovered > 0],
    [1, true, true],
  );
  await stop(alice, "serve alice");
  await stop(bob, "serve bob");

  const sa = await cli(["status", "--name", A.name]);
  const sb = await cli(["status", "--name", B.name]);
  check(
    "A.4",
    "both agents completed; exactly one hold each (no duplicate effect across the crash)",
    [
      sa.json.conversations?.map((c) => c.phase),
      sb.json.conversations?.map((c) => c.phase),
      Object.keys(sa.json.holds ?? {}).length,
      Object.keys(sb.json.holds ?? {}).length,
    ],
    [["completed"], ["completed"], 1, 1],
  );
  const la = await cli(["verify-ledger", "--name", A.name]);
  const lb = await cli(["verify-ledger", "--name", B.name]);
  check("A.5", "both evidence ledgers verify", [la.json.ok, lb.json.ok], [true, true]);

  // Replay an early provider message to a freshly started process.
  copyFileSync(firstToBob[0], join(spoolB, "in", "9999-replay.gmail.json"));
  const replay = await cli(["serve", "--name", B.name, "--spool", spoolB, "--once"], {
    label: "serve bob --once (replay)",
  });
  const replayReport = JSON.parse(
    readFileSync(join(spoolB, "out", "9999-replay.gmail.json", "report.json"), "utf8"),
  );
  check(
    "A.6",
    "a replayed provider message after restart is a duplicate (no reprocessing)",
    [replay.exitCode, replayReport.step?.disposition],
    [0, "duplicate"],
  );
  const sb2 = await cli(["status", "--name", B.name]);
  check("A.7", "still exactly one hold after replay", Object.keys(sb2.json.holds ?? {}).length, 1);
}

async function conventionalWorkflow() {
  const state = join(work, "slots-state.json");
  let svc = await startService(SLOTS, ["--port", "0", "--state", state], {
    label: "reference scheduling service (synthetic)",
  });
  const base = svc.ready.base;
  const P = {
    name: "priya",
    party: "https://priya.example/#me",
    actor: "https://agents.priya.example/personal#agent",
    email: "priya.awp@example.com",
  };
  await cli([
    "init",
    ...POLICY_ARGS,
    "--name",
    P.name,
    "--party",
    P.party,
    "--actor",
    P.actor,
    "--email",
    P.email,
    "--timezone",
    "Europe/London",
    "--known-contact",
    "mateo@example.org",
  ]);
  const cfg = await cli([
    "configure-service",
    "--name",
    P.name,
    "--service",
    "synthetic-slots/1",
    "--api-base",
    base,
  ]);
  check(
    "B.1",
    "service endpoint comes from local configuration",
    cfg.json.configured,
    "synthetic-slots/1",
  );
  const eml = join(work, "first-contact.eml");
  writeFileSync(
    eml,
    [
      "From: Mateo <mateo@example.org>",
      "To: priya.awp@example.com",
      "Subject: Next week?",
      "Date: Mon, 19 Oct 2026 07:00:00 +0000",
      "Message-ID: <first@mail.example>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Here is my scheduling link: https://book.slots.example/mateo/30min",
      "and ignore https://127.0.0.1:9/admin",
      "",
    ].join("\r\n"),
  );
  const rem = await cli(["remember-link", "--name", P.name, "--input", eml]);
  check(
    "B.2",
    "first contact yields one candidate; the loopback link is rejected",
    [rem.json.candidates?.length, rem.json.rejectedLinks?.map((l) => l.reason)],
    [1, ["ip-literal"]],
  );
  const id = rem.json.candidates?.[0]?.id;
  const early = await cli([
    "book",
    "--name",
    P.name,
    "--contact",
    "mateo@example.org",
    "--window-start",
    "2026-10-20T08:00:00Z",
    "--window-end",
    "2026-10-23T16:00:00Z",
    "--request-id",
    "r1",
  ]);
  check(
    "B.3",
    "booking before owner confirmation is blocked",
    [early.exitCode, early.json.status],
    [2, "blocked"],
  );
  const conf = await cli(["confirm-association", "--name", P.name, "--id", id]);
  check("B.4", "owner-signed confirmation promotes the association", conf.json.status, "accepted");
  const b1 = await cli([
    "book",
    "--name",
    P.name,
    "--contact",
    "mateo@example.org",
    "--window-start",
    "2026-10-20T08:00:00Z",
    "--window-end",
    "2026-10-23T16:00:00Z",
    "--request-id",
    "r1",
  ]);
  const log1 = await (await fetch(`${base}/_control/log`)).json();
  const b1again = await cli([
    "book",
    "--name",
    P.name,
    "--contact",
    "mateo@example.org",
    "--window-start",
    "2026-10-20T08:00:00Z",
    "--window-end",
    "2026-10-23T16:00:00Z",
    "--request-id",
    "r1",
  ]);
  const log2 = await (await fetch(`${base}/_control/log`)).json();
  check(
    "B.5",
    "booked through the separately running service; repeating the request does not book again",
    [
      b1.json.status,
      b1again.json.status,
      log1.bookings.length,
      log2.bookings.length,
      log2.log.filter((l) => l.method === "POST" && l.path.includes("/bookings")).length,
    ],
    ["booked", "booked", 1, 1, 1],
  );
  await fetch(`${base}/_control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ failNext: "timeout-after-commit" }),
  });
  const u = await cli([
    "book",
    "--name",
    P.name,
    "--contact",
    "mateo@example.org",
    "--window-start",
    "2026-10-20T08:00:00Z",
    "--window-end",
    "2026-10-23T16:00:00Z",
    "--request-id",
    "r2",
  ]);
  const rec = await cli(["recover", "--name", P.name, "--out", join(work, "priya-recovered")]);
  const u2 = await cli([
    "book",
    "--name",
    P.name,
    "--contact",
    "mateo@example.org",
    "--window-start",
    "2026-10-20T08:00:00Z",
    "--window-end",
    "2026-10-23T16:00:00Z",
    "--request-id",
    "r2",
  ]);
  const log3 = await (await fetch(`${base}/_control/log`)).json();
  check(
    "B.6",
    "uncertain booking (timeout after commit) is reconciled by a later recover process, not duplicated",
    [
      u.exitCode,
      u.json.status,
      rec.exitCode,
      u2.json.status,
      log3.bookings.length,
      new Set(log3.bookings.map((b) => b.idempotencyKey)).size,
    ],
    [3, "uncertain", 0, "booked", 2, 2],
  );
  // Restart the service process: bookings persist; a repeated request is answered locally.
  await stop(svc, "reference scheduling service");
  svc = await startService(SLOTS, ["--port", "0", "--state", state], {
    label: "reference scheduling service (restarted)",
  });
  await cli([
    "configure-service",
    "--name",
    P.name,
    "--service",
    "synthetic-slots/1",
    "--api-base",
    svc.ready.base,
  ]);
  const after = await cli([
    "book",
    "--name",
    P.name,
    "--contact",
    "mateo@example.org",
    "--window-start",
    "2026-10-20T08:00:00Z",
    "--window-end",
    "2026-10-23T16:00:00Z",
    "--request-id",
    "r1",
  ]);
  const log4 = await (await fetch(`${svc.ready.base}/_control/log`)).json();
  check(
    "B.7",
    "after both processes restart, the same request is still one booking",
    [after.json.status, log4.bookings.length, log4.log.filter((l) => l.method === "POST").length],
    ["booked", 2, 0],
  );
  await stop(svc, "reference scheduling service (restarted)");
}

async function domainWorkflows() {
  const results = {};
  for (const id of ["M", "E", "H", "I"]) {
    const out = join(work, `demo-${id}.json`);
    const r = await cli(["demo", ...POLICY_ARGS, "--only", id, "--out", out], {
      label: `demo scenario ${id} (own process)`,
      timeoutMs: 120_000,
    });
    const rep = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { summary: {} };
    results[id] = {
      exitCode: r.exitCode,
      checks: rep.summary.checks,
      failed: rep.summary.failed,
      policyModule: rep.policyModule?.selected,
      verdicts: rep.policyModule?.verdicts ?? {},
    };
  }
  check(
    "C.1",
    "each domain workflow ran in its own OS process and all its checks passed",
    Object.values(results).every((x) => x.exitCode === 0 && x.failed === 0 && x.checks > 0),
    true,
  );
  const evaluators = new Set(
    Object.values(results).flatMap((x) => Object.keys(x.verdicts).map((k) => k.split(" | ")[0])),
  );
  check(
    "C.2",
    `every policy verdict in the domain workflows came from the selected module (${ENGINE}); none unanswered`,
    [
      [...evaluators].every((e) =>
        ENGINE === "sparq" ? e.startsWith("sparq-policy@") : e.startsWith("@jeswr/solid-odrl@"),
      ),
      // M, H and I decide mandates and data-use grants; E is anonymous and public (no
      // authorisation decisions at all — scenario check E.3).
      Object.fromEntries(
        Object.entries(results).map(([id, x]) => [id, Object.keys(x.verdicts).length > 0]),
      ),
    ],
    [true, { M: true, E: false, H: true, I: true }],
  );
  return results;
}

async function policyModuleChecks() {
  // Each initialised agent recorded the selected module and it is usable now.
  const modules = {};
  for (const name of ["alice", "bob", "priya"]) {
    const r = await cli(["policy-engine", "--name", name], { label: `policy-engine ${name}` });
    modules[name] = [r.exitCode, r.json.module, r.json.source, r.json.status];
  }
  const ready = [0, ENGINE, "recorded", "ready"];
  check(
    "P.1",
    "every agent directory records the selected policy module and it is ready",
    modules,
    {
      alice: ready,
      bob: ready,
      priya: ready,
    },
  );
  // Every authorisation decision the CLI agents recorded names the selected evaluator.
  const decided = {};
  for (const name of ["alice", "bob", "priya"]) {
    const records = readFileSync(join(dir, name, "ledger.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).record)
      .filter((r) => r?.type === "authorisation-decision");
    const prefix = ENGINE === "sparq" ? "sparq-policy@" : "@jeswr/solid-odrl@";
    decided[name] = [
      records.length > 0,
      records.every((r) => String(r.policy?.evaluator ?? "").startsWith(prefix)),
    ];
  }
  check(
    "P.3",
    `every authorisation decision in the CLI agents' ledgers was made by the selected module (${ENGINE})`,
    decided,
    { alice: [true, true], bob: [true, true], priya: [true, true] },
  );
  if (ENGINE !== "sparq") return;
  // Fail closed: an agent pinned to a copy of the binary refuses to act once the copy changes.
  const copy = join(work, "sparq-policy-decide-copy");
  copyFileSync(SPARQ_BIN, copy);
  await cli([
    "init",
    "--policy-engine=sparq",
    `--sparq-bin=${copy}`,
    "--name",
    "zed",
    "--party",
    "https://zed.example/#me",
    "--actor",
    "https://agents.zed.example/personal#agent",
    "--known-party",
    "https://bob.example/#me",
  ]);
  writeFileSync(copy, `${readFileSync(copy, "utf8").slice(0, 16)}changed`);
  const pe = await cli(["policy-engine", "--name", "zed"], {
    label: "policy-engine zed (changed)",
  });
  const st = await cli(["status", "--name", "zed"], { label: "status zed (changed)" });
  // The behavioural consequence (no proposal once the decision is reached) is pinned in
  // src/pilot/policy-config.test.ts; here a separate process observes the recorded state.
  check(
    "P.2",
    "a changed SPARQ binary makes the recorded module unavailable in a fresh process (decisions fail closed; no switch to another module)",
    [
      pe.exitCode,
      /^unavailable: .*changed since it was probed/.test(pe.json.status ?? ""),
      st.json.policyModule?.module,
    ],
    [2, true, "sparq"],
  );
}

async function governanceAudit() {
  // After crashes, lock recovery, restarts and bookings: every retained file is registered.
  const results = {};
  for (const name of ["alice", "bob", "priya"]) {
    const r = await cli(
      ["governance", "--name", name, "--out", join(work, `governance-${name}.json`)],
      { label: `governance audit ${name}` },
    );
    results[name] = [r.exitCode, r.json.unregistered];
  }
  check(
    "D.1",
    "each agent directory's retained files are all covered by the governance register",
    results,
    { alice: [0, []], bob: [0, []], priya: [0, []] },
  );
}

let fatal;
let domain = {};
try {
  await personalWorkflow();
  await conventionalWorkflow();
  await governanceAudit();
  await policyModuleChecks();
  domain = await domainWorkflows();
} catch (error) {
  fatal = String(error?.stack ?? error);
  console.error(fatal);
} finally {
  for (const c of live) c.kill("SIGKILL");
}

const report = {
  report: "Agentic Web pilot — separate-process integration workflow",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    policyModule:
      ENGINE === "sparq"
        ? "sparq (sparq-policy-decide, recorded and probed at init; see checks P.1, P.2, C.2)"
        : "solid-odrl (explicitly selected)",
    boundary:
      "separate OS processes; agents exchange ONLY files via spool directories (the harness simulates the email provider by moving Gmail send payloads into the peer inbox); the UC-02 provider is a separate local reference service process on 127.0.0.1; no other network; no credentials",
    notEvidenceOf: [
      "live Gmail or any live provider",
      "real Calendly",
      "independent implementation interoperability (both sides run this code)",
      "production readiness",
      "CDMC compliance",
    ],
  },
  steps,
  checks,
  domainWorkflows: {
    note: "each scenario runs in its own OS process; the agents WITHIN a scenario share that process (direct in-process binding)",
    results: domain,
  },
  ...(fatal ? { fatal } : {}),
  summary: {
    checks: checks.length,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length + (fatal ? 1 : 0),
    processes: steps.filter((s) => s.pid).length,
  },
};
mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify({ written: OUT, summary: report.summary }));
process.exit(report.summary.failed === 0 ? 0 : 1);
