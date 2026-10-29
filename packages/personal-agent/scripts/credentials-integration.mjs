#!/usr/bin/env node
// Credential helper — real-process checks (SYNTHETIC ONLY, temporary directory, no provider).
// Requires `npm run build`.
//
//  1. human-facing CLI processes: client google (synthetic Desktop client file), profile add,
//     status — no secret in any output; private directory/file modes;
//  2. the helper PROTOCOL across a process boundary: the actions' own HelperTokenProvider runs
//     `awp-credentials token` from the generated provider configuration and receives the cached
//     (synthetic) token; another connection and a grant needing re-consent are refused;
//  3. concurrent refresh across N separate processes (fake token endpoint inside each process,
//     shared state in files): exactly ONE refresh, every process gets the same token; Microsoft
//     refresh-token rotation across processes keeps the latest token usable;
//  4. cleanup in `finally`.
//
// Usage: node scripts/credentials-integration.mjs [--out=reports/credentials-integration-report.json]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(root, "dist", "credentials", "cli.js");
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(root, "reports", "credentials-integration-report.json");
if (!existsSync(CLI)) {
  console.error("build first: npm run build");
  process.exit(2);
}
const { CredentialStore } = await import(
  pathToFileURL(join(root, "dist/credentials/store.js")).href
);
const { HelperTokenProvider, loadProviderConfig, CredentialError } = await import(
  pathToFileURL(join(root, "dist/actions/providers/credentials.js")).href
);

const work = mkdtempSync(join(tmpdir(), "awp-cred-int-"));
const dir = join(work, "store");
const SECRET = "GOCSPX-synthetic-placeholder";
const AT = `at-synthetic-${"x".repeat(24)}`;
const RT = `rt-synthetic-${"y".repeat(24)}`;
const checks = [];
const check = (id, claim, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ id, claim, expected, actual, pass });
  if (!pass)
    console.error(
      `FAIL ${id}: ${claim}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
};
const deadline = setTimeout(() => {
  console.error("credentials integration exceeded its time limit");
  rmSync(work, { recursive: true, force: true });
  process.exit(4);
}, 120_000);

function run(cmd, args, input) {
  return new Promise((done) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => done({ code, out, err }));
    child.stdin.end(input ?? "");
  });
}
const helper = (...args) => run(process.execPath, [CLI, "--dir", dir, ...args]);

// A child process that asks for a token with an IN-PROCESS fake token endpoint (no network);
// the fake's state (refresh count, current rotating refresh token) is shared through files.
const CHILD = join(work, "child.mjs");
writeFileSync(
  CHILD,
  `
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
const [storeUrl, opsUrl, dir, profile, shared, rotate, barrier] = process.argv.slice(2);
const { CredentialStore } = await import(storeUrl);
const { accessToken } = await import(opsUrl);
const transport = async (url, init) => {
  const f = new URLSearchParams(String(init.body));
  const current = existsSync(shared + ".rt") ? readFileSync(shared + ".rt", "utf8") : null;
  if (current !== null && f.get("refresh_token") !== current)
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  appendFileSync(shared, process.pid + "\\n");
  await sleep(300);
  const n = readFileSync(shared, "utf8").trim().split("\\n").length;
  let next;
  if (rotate === "1") { next = "rt-rotated-" + n + "-" + "z".repeat(20); writeFileSync(shared + ".rt", next); }
  return new Response(JSON.stringify({ access_token: "at-refreshed-" + n + "-" + "w".repeat(20), expires_in: 3600,
    scope: rotate === "1" ? "https://graph.microsoft.com/Calendars.ReadBasic" : "https://www.googleapis.com/auth/calendar.freebusy",
    token_type: "Bearer", ...(next ? { refresh_token: next } : {}) }), { status: 200 });
};
while (!existsSync(barrier)) await sleep(5);
const t = await accessToken({ store: new CredentialStore(dir), transport, now: () => new Date() }, profile);
process.stdout.write(JSON.stringify({ token: t.token }));
`,
);
const storeUrl = pathToFileURL(join(root, "dist/credentials/store.js")).href;
const opsUrl = pathToFileURL(join(root, "dist/credentials/operations.js")).href;

async function concurrent(profile, n, shared, rotate) {
  const barrier = join(work, `go-${profile}-${Date.now()}`);
  const kids = Array.from({ length: n }, () =>
    run(process.execPath, [
      CHILD,
      storeUrl,
      opsUrl,
      dir,
      profile,
      shared,
      rotate ? "1" : "0",
      barrier,
    ]),
  );
  await new Promise((r) => setTimeout(r, 400)); // let every process start and wait at the barrier
  writeFileSync(barrier, "");
  const results = await Promise.all(kids);
  return {
    exits: results.map((r) => r.code),
    tokens: [
      ...new Set(
        results.map((r) => {
          try {
            return JSON.parse(r.out).token;
          } catch {
            return r.err.slice(0, 200);
          }
        }),
      ),
    ],
    refreshes: existsSync(shared) ? readFileSync(shared, "utf8").trim().split("\n").length : 0,
  };
}

const grant = (profile, provider, extra) => ({
  version: 1,
  profile,
  provider,
  // Grants are bound to the client they were issued to (the synthetic clients registered below).
  clientId:
    provider === "google"
      ? "000000000000-synthetic.apps.googleusercontent.com"
      : "00000000-1111-4222-8333-444444444444",
  account: {
    subject: "synthetic-subject",
    username: "owner@example.com",
    ...(provider === "microsoft" ? { tenant: "9188040d-6c67-4c5b-b112-36a304b66dad" } : {}),
  },
  grantedScopes:
    provider === "google"
      ? ["https://www.googleapis.com/auth/calendar.freebusy"]
      : ["Calendars.ReadBasic"],
  state: "active",
  refreshToken: RT,
  obtainedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra,
});

let fatal;
try {
  const clientFile = join(work, "client_secret_synthetic.json");
  writeFileSync(
    clientFile,
    JSON.stringify({
      installed: {
        client_id: "000000000000-synthetic.apps.googleusercontent.com",
        client_secret: SECRET,
        token_uri: "https://oauth2.googleapis.com/token",
      },
    }),
  );
  const c = await helper("client", "google", "--client-file", clientFile);
  const p1 = await helper(
    "profile",
    "add",
    "--name",
    "g1",
    "--provider",
    "google",
    "--connection",
    "acct-google",
    "--account",
    "owner@example.com",
  );
  const p2 = await helper(
    "profile",
    "add",
    "--name",
    "g2",
    "--provider",
    "google",
    "--connection",
    "acct-google-2",
    "--account",
    "owner@example.com",
  );
  const ms = await helper(
    "client",
    "microsoft",
    "--client-id",
    "00000000-1111-4222-8333-444444444444",
  );
  const p3 = await helper(
    "profile",
    "add",
    "--name",
    "m1",
    "--provider",
    "microsoft",
    "--connection",
    "acct-ms",
    "--account",
    "owner@example.com",
    "--account-type",
    "personal",
  );
  check(
    "C.1",
    "human-facing setup commands run as separate processes",
    [c.code, p1.code, p2.code, ms.code, p3.code],
    [0, 0, 0, 0, 0],
  );

  const store = new CredentialStore(dir);
  // g1: a valid cached token (no network needed); g2: expired (refresh); m1: expired, rotating.
  store.putGrant(
    grant("g1", "google", {
      access: { token: AT, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
    }),
  );
  store.putGrant(
    grant("g2", "google", {
      access: { token: AT, expiresAt: new Date(Date.now() - 1000).toISOString() },
    }),
  );
  store.putGrant(grant("m1", "microsoft", {}));
  const st = await helper("status");
  const stj = await helper("status", "--json");
  const all = c.out + c.err + p1.out + st.out + st.err + stj.out;
  check(
    "C.2",
    "status and setup output never contain the client secret, access or refresh token; directory 0700, files 0600",
    [
      st.code,
      [SECRET, AT, RT].some((s) => all.includes(s)),
      statSync(dir).mode & 0o777,
      statSync(join(dir, "grants", "g1.json")).mode & 0o777,
      statSync(join(dir, "clients", "google.json")).mode & 0o777,
    ],
    [0, false, 0o700, 0o600, 0o600],
  );

  const configPath = join(work, "providers.json");
  const pc = await helper("provider-config", "--out", configPath);
  const config = loadProviderConfig(configPath);
  const tokens = new HelperTokenProvider(config);
  const got = await tokens.getAccessToken({
    provider: "google",
    connectionId: "acct-google",
    scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
  });
  let other;
  try {
    await tokens.getAccessToken({ provider: "google", connectionId: "not-configured", scopes: [] });
  } catch (e) {
    other = e instanceof CredentialError ? e.code : String(e);
  }
  store.putGrant(
    grant("g1", "google", {
      state: "needs-reconsent",
      refreshToken: undefined,
      problem: "synthetic revocation",
    }),
  );
  let revoked;
  try {
    await tokens.getAccessToken({
      provider: "google",
      connectionId: "acct-google",
      scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
    });
  } catch (e) {
    revoked = e instanceof CredentialError ? e.code : String(e);
  }
  check(
    "C.3",
    "the actions' HelperTokenProvider runs `awp-credentials token` from the generated config (separate process) and receives the token privately; unknown connection and re-consent-needed grants are refused",
    [
      pc.code,
      config.accounts.length,
      got.token === AT,
      other,
      revoked,
      readFileSync(configPath, "utf8").includes(AT),
    ],
    [0, 3, true, "not-configured", "revoked", false],
  );

  const g = await concurrent("g2", 6, join(work, "g2.count"), false);
  check(
    "C.4",
    "six separate processes needing a refresh at once: exactly one refresh (cross-process lock); all receive the same new token",
    [g.exits, g.tokens.length, g.refreshes, /^at-refreshed-1-/.test(g.tokens[0] ?? "")],
    [[0, 0, 0, 0, 0, 0], 1, 1, true],
  );
  const m = await concurrent("m1", 4, join(work, "m1.count"), true);
  const afterFirst = new CredentialStore(dir).grant("m1").refreshToken;
  // Expire the cached token again: the NEXT refresh must present the rotated refresh token.
  const g2 = new CredentialStore(dir).grant("m1");
  new CredentialStore(dir).putGrant({
    ...g2,
    access: { ...g2.access, expiresAt: new Date(Date.now() - 1000).toISOString() },
  });
  const m2 = await concurrent("m1", 3, join(work, "m1.count"), true);
  check(
    "C.5",
    "Microsoft rotation across processes: one refresh per round, the rotated refresh token is stored and the next round (presenting it) succeeds",
    [
      m.exits,
      m.refreshes,
      afterFirst?.startsWith("rt-rotated-1-"),
      m2.exits,
      m2.refreshes,
      new CredentialStore(dir).grant("m1").refreshToken?.startsWith("rt-rotated-2-"),
    ],
    [[0, 0, 0, 0], 1, true, [0, 0, 0], 2, true],
  );
  check(
    "C.6",
    "no lock file is left behind",
    ["g2", "m1"].map((n) => existsSync(join(dir, "locks", `${n}.lock`))),
    [false, false],
  );
} catch (error) {
  fatal = String(error?.stack ?? error).slice(0, 2000);
  console.error(fatal);
} finally {
  rmSync(work, { recursive: true, force: true });
  clearTimeout(deadline);
}

const report = {
  report: "Credential helper — real-process checks (synthetic, temporary directory, no provider)",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    providers:
      "none: in-process fake token endpoints in the child processes; no network, no consent",
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
