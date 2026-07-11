/**
 * Vitest global setup for the LIVE authorization-code spec: boot ONE in-memory CSS v8 on a FRESH
 * port (3086 — 3087+ are taken by sibling suites), seeded with one account+pod whose WebID is
 * linked. We do NOT provision client-credentials here (the auth-code flow registers its own client
 * via DCR); instead we log the seeded user in via the `.account` password API and export the
 * session COOKIE + the account-controls base URL + the linked WebID, so the spec can drive the
 * CSS OIDC interaction headlessly (pick-webid + consent) as the logged-in user.
 *
 * Exports via env: CSS_AUTHCODE_BASE, CSS_AUTHCODE_POD, CSS_AUTHCODE_ISSUER, CSS_AUTHCODE_COOKIE,
 * CSS_AUTHCODE_WEBID, CSS_AUTHCODE_ACCOUNT_URL, CSS_AUTHCODE_EMAIL, CSS_AUTHCODE_PASSWORD.
 * If login/seed fails, the env vars are left unset and the live spec self-skips with a reason.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const CSS_BIN = require.resolve("@solid/community-server/bin/server.js");

const PORT = 3086;
const BASE = `http://localhost:${PORT}/`;
const POD = `${BASE}alice/`;
const EMAIL = "alice@example.com";
const PASSWORD = "alice-secret";

let css: ChildProcess | undefined;
let seedDir: string | undefined;

async function waitForCss(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CSS did not become ready at ${url} within ${timeoutMs}ms`);
}

interface Controls {
  password?: { login?: string };
  account?: { webId?: string };
}

/** Log the seeded account in and return its session cookie + linked WebID, or undefined on drift. */
async function loginAndResolveWebId(): Promise<{ cookie: string; webId: string } | undefined> {
  try {
    const accountUrl = new URL(".account/", BASE).toString();
    const ctrl = (await (
      await fetch(accountUrl, { headers: { accept: "application/json" } })
    ).json()) as {
      controls?: Controls;
    };
    const loginUrl = ctrl.controls?.password?.login;
    if (!loginUrl) {
      process.stderr.write("[live-setup] no password.login control; skipping\n");
      return undefined;
    }

    const loginRes = await fetch(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const setCookie = loginRes.headers.get("set-cookie");
    if (!loginRes.ok || !setCookie) {
      process.stderr.write(`[live-setup] login failed (${loginRes.status}); skipping\n`);
      return undefined;
    }
    const cookie = setCookie.split(";")[0] as string;

    const authedCtrl = (await (
      await fetch(accountUrl, { headers: { accept: "application/json", cookie } })
    ).json()) as { controls?: Controls };
    const webIdUrl = authedCtrl.controls?.account?.webId;
    if (!webIdUrl) {
      process.stderr.write("[live-setup] no account.webId control; skipping\n");
      return undefined;
    }
    const webIdJson = (await (
      await fetch(webIdUrl, { headers: { accept: "application/json", cookie } })
    ).json()) as { webIdLinks?: Record<string, string> };
    const webId = Object.keys(webIdJson.webIdLinks ?? {})[0] ?? `${POD}profile/card#me`;
    return { cookie, webId };
  } catch (e) {
    process.stderr.write(`[live-setup] error: ${(e as Error).message}\n`);
    return undefined;
  }
}

export async function setup(): Promise<void> {
  let reused = false;
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    if (res.ok) reused = true;
  } catch {
    // none running
  }

  if (!reused) {
    seedDir = await mkdtemp(join(tmpdir(), "solid-dpop-authcode-css-"));
    const seedPath = join(seedDir, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify([{ email: EMAIL, password: PASSWORD, pods: [{ name: "alice" }] }]),
    );

    const logChunks: string[] = [];
    css = spawn(
      process.execPath,
      [CSS_BIN, "-p", String(PORT), "-l", "warn", "--seedConfig", seedPath],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    css.stdout?.on("data", (d) => logChunks.push(String(d)));
    css.stderr?.on("data", (d) => logChunks.push(String(d)));
    css.on("exit", (code) => {
      if (code !== null && code !== 0) logChunks.push(`\n[CSS exited code ${code}]\n`);
    });

    try {
      await waitForCss(BASE, 90_000);
    } catch (e) {
      throw new Error(`${(e as Error).message}\n--- CSS output ---\n${logChunks.join("")}`);
    }
  }

  process.env["CSS_AUTHCODE_BASE"] = BASE;
  process.env["CSS_AUTHCODE_POD"] = POD;
  process.env["CSS_AUTHCODE_ISSUER"] = BASE;
  process.env["CSS_AUTHCODE_ACCOUNT_URL"] = new URL(".account/", BASE).toString();
  process.env["CSS_AUTHCODE_EMAIL"] = EMAIL;
  process.env["CSS_AUTHCODE_PASSWORD"] = PASSWORD;

  const login = await loginAndResolveWebId();
  if (login) {
    process.env["CSS_AUTHCODE_COOKIE"] = login.cookie;
    process.env["CSS_AUTHCODE_WEBID"] = login.webId;
  }
}

export async function teardown(): Promise<void> {
  if (css && !css.killed) {
    css.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!css.killed) css.kill("SIGKILL");
  }
  if (seedDir) await rm(seedDir, { recursive: true, force: true }).catch(() => undefined);
}
