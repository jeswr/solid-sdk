// AUTHORED-BY Claude Opus 4.8
/**
 * seed-pod.ts — boot a local in-memory CSS v8 + a seeded account, then return
 * client-credentials so the developer (or a test) can mint a login token
 * immediately. Used by the `--seed-pod` flag.
 *
 * The CSS-boot + client-credentials provisioning is copied from the proven
 * integrations/wix-solid/test/global-setup.ts harness, moved to PORT 3088
 * (3089+ are taken by sibling suites per that file's port-allocation note).
 *
 * SEAM (spec D1): this module is the "run-time seeding" mechanism (spec §8
 * mechanism 1, the verified default). The boot-time-templates alternative
 * (mechanism 2: a custom CSS config + pod-templates so pods are *born* with
 * pim:storage) would be a sibling module selected here — the caller never PATCHes
 * a profile after start either way.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const SEED_POD_PORT = 3088;

export interface SeededPod {
  baseUrl: string;
  issuer: string;
  podUrl: string;
  webId: string;
  email: string;
  password: string;
  /** Client-credentials for minting a DPoP-bound token (login proof). */
  clientId?: string;
  clientSecret?: string;
  /** Stop the CSS process this module started (no-op if it was reused). */
  stop: () => Promise<void>;
}

const EMAIL = "alice@example.com";
const PASSWORD = "alice-secret";

function resolveCssBin(): string {
  // Resolvable from the CLI package's own node_modules (devDependency) OR from
  // any sibling integration that installed CSS (workspace fallback).
  const candidates = [
    "@solid/community-server/bin/server.js",
    join(
      process.cwd(),
      "integrations/wix-solid/node_modules/@solid/community-server/bin/server.js",
    ),
  ];
  for (const c of candidates) {
    try {
      return require.resolve(c);
    } catch {
      // try next
    }
  }
  throw new Error(
    "@solid/community-server is not installed. Add it as a devDependency of the " +
      "CLI (`npm install` in dx/create-solid-app) before using --seed-pod.",
  );
}

/**
 * Stop a child gracefully: SIGTERM, then await its real `exit` (or already-exited state) up to
 * `graceMs`; only if it has not exited by then do we SIGKILL. We key off the actual `exit` event /
 * `exitCode`, NOT `child.killed` — `killed` only records that a signal was *delivered*, so a process
 * still shutting down reports `killed === true` and the SIGKILL fallback would never fire.
 */
async function stopChild(child: ChildProcess, graceMs = 500): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return; // already exited
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), graceMs)),
  ]);
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

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
  account?: { clientCredentials?: string; webId?: string };
}

/**
 * Parse a control response as JSON, treating a non-OK status or an unparsable body as "no controls"
 * (undefined). On the port-reuse path the listener may be a foreign server returning HTML / an error
 * — throwing here would mask the actionable "port in use but not seeded CSS" error raised in
 * `seedPod`, so we swallow the parse failure and let provisioning fall through to undefined.
 */
async function readControls(res: Response): Promise<{ controls?: Controls } | undefined> {
  if (!res.ok) return undefined;
  try {
    return (await res.json()) as { controls?: Controls };
  } catch {
    return undefined;
  }
}

async function provisionClientCredentials(
  base: string,
  podUrl: string,
): Promise<{ id: string; secret: string; webId: string } | undefined> {
  const accountUrl = new URL(".account/", base).toString();
  const ctrlRes = await fetch(accountUrl, { headers: { accept: "application/json" } });
  const ctrl = await readControls(ctrlRes);
  const loginUrl = ctrl?.controls?.password?.login;
  if (!loginUrl) return undefined;

  const loginRes = await fetch(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookie = loginRes.headers.get("set-cookie");
  if (!loginRes.ok || !setCookie) return undefined;
  const cookie = setCookie.split(";")[0] as string;

  const authedCtrlRes = await fetch(accountUrl, {
    headers: { accept: "application/json", cookie },
  });
  const authedCtrl = await readControls(authedCtrlRes);
  const ccUrl = authedCtrl?.controls?.account?.clientCredentials;
  const webIdUrl = authedCtrl?.controls?.account?.webId;
  if (!ccUrl || !webIdUrl) return undefined;

  const webIdRes = await fetch(webIdUrl, { headers: { accept: "application/json", cookie } });
  const webIdJson = (await webIdRes.json()) as { webIdLinks?: Record<string, string> };
  const webId = Object.keys(webIdJson.webIdLinks ?? {})[0] ?? `${podUrl}profile/card#me`;

  const ccRes = await fetch(ccUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", cookie },
    body: JSON.stringify({ name: "create-solid-app-seed", webId }),
  });
  if (!ccRes.ok) return undefined;
  const cc = (await ccRes.json()) as { id?: string; secret?: string };
  if (!cc.id || !cc.secret) return undefined;
  return { id: cc.id, secret: cc.secret, webId };
}

export interface SeedPodOptions {
  port?: number;
  /** Boot timeout (CSS is slow: ~13-15s Components.js parse). */
  timeoutMs?: number;
}

/** Boot (or reuse) CSS on the seed-pod port, seed alice, return credentials. */
export async function seedPod(opts: SeedPodOptions = {}): Promise<SeededPod> {
  const port = opts.port ?? SEED_POD_PORT;
  const base = `http://localhost:${port}/`;
  const podUrl = `${base}alice/`;

  let reused = false;
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
    if (res.ok) reused = true;
  } catch {
    // none running — we boot one
  }

  let css: ChildProcess | undefined;
  let seedDir: string | undefined;

  if (!reused) {
    const cssBin = resolveCssBin();
    seedDir = await mkdtemp(join(tmpdir(), "create-solid-app-css-"));
    const seedPath = join(seedDir, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify([{ email: EMAIL, password: PASSWORD, pods: [{ name: "alice" }] }]),
    );

    const logChunks: string[] = [];
    css = spawn(
      process.execPath,
      [cssBin, "-p", String(port), "-l", "warn", "--seedConfig", seedPath],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    css.stdout?.on("data", (d) => logChunks.push(String(d)));
    css.stderr?.on("data", (d) => logChunks.push(String(d)));

    try {
      await waitForCss(base, opts.timeoutMs ?? 180_000);
    } catch (e) {
      css.kill("SIGKILL");
      throw new Error(`${(e as Error).message}\n--- CSS output ---\n${logChunks.join("")}`);
    }
  }

  const cc = await provisionClientCredentials(base, podUrl);

  // When we reused a pre-existing listener on this port, we did NOT boot it and cannot assume it is
  // the seeded CSS with the `alice` account. Provisioning client-credentials requires a successful
  // `alice` password login against the CSS `.account` API, so a successful `cc` proves the reused
  // listener is the seeded CSS. If provisioning failed on the reuse path, fail loudly rather than
  // returning fallback creds that point at someone else's server.
  if (reused && !cc) {
    throw new Error(
      `Port ${port} is already in use, but the listener there is not the seeded CSS / does not have ` +
        `the seeded "alice" account (client-credentials provisioning failed). Stop whatever is on ` +
        `${base} (or choose a different port) and retry --seed-pod.`,
    );
  }

  const stop = async (): Promise<void> => {
    if (seedDir) await rm(seedDir, { recursive: true, force: true }).catch(() => undefined);
    if (css) await stopChild(css);
  };

  return {
    baseUrl: base,
    issuer: base,
    podUrl,
    webId: cc?.webId ?? `${podUrl}profile/card#me`,
    email: EMAIL,
    password: PASSWORD,
    clientId: cc?.id,
    clientSecret: cc?.secret,
    stop,
  };
}

/**
 * Mint a DPoP-bound access token from client-credentials — the proof that the
 * printed credentials actually log in. Returns the token endpoint response.
 */
export async function requestClientCredentialsToken(pod: SeededPod): Promise<{
  ok: boolean;
  status: number;
  accessToken?: string;
}> {
  if (!pod.clientId || !pod.clientSecret) {
    return { ok: false, status: 0 };
  }
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { randomUUID } = await import("node:crypto");

  const tokenEndpoint = new URL(".oidc/token", pod.baseUrl).toString();
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "ES256" };
  const proof = await new SignJWT({ htu: tokenEndpoint, htm: "POST", jti: randomUUID() })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
    .setIssuedAt()
    .sign(privateKey);

  const basic = Buffer.from(
    `${encodeURIComponent(pod.clientId)}:${encodeURIComponent(pod.clientSecret)}`,
  ).toString("base64");
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      dpop: proof,
    },
    body: "grant_type=client_credentials&scope=webid",
  });
  if (!res.ok) return { ok: false, status: res.status };
  // `access_token` is the OAuth 2.0 token-endpoint wire field (RFC 6749 §5.1) —
  // snake_case is fixed by the protocol, not a naming choice.
  // biome-ignore lint/style/useNamingConvention: OAuth wire field (RFC 6749 §5.1).
  const json = (await res.json()) as { access_token?: string };
  return { ok: true, status: res.status, accessToken: json.access_token };
}
