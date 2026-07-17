// AUTHORED-BY Claude Fable 5
/**
 * Test-only dev/test Solid-server harness — ported from the reviewed
 * reference implementation's test plumbing (`get-port` replaced with a local
 * net probe). Boots sparq's `@jeswr/solid-server` (the vendored
 * `sparq-lws-wasm` WASM distribution): one in-memory pod instance per identity
 * on dynamically acquired ports.
 *
 * Two modes:
 * - fixed-owner (default): every request acts as the pod owner — no authentication, ideal
 *   for pod-IO tests. Anonymous/denied paths are NOT testable here by construction.
 * - `oidc: true`: the host verifies real DPoP-bound Solid-OIDC access tokens; each account
 *   gets a local dev issuer, so WAC allow/deny across identities is real. The dev-issuer
 *   fixture (discovery doc + JWKS + WebID doc + `at+jwt` minting) is lifted from sparq's
 *   own `packages/solid-server/test/oidc.test.mjs` (sparq-org/sparq @ 947480b0), which
 *   passes `@solid/access-token-verifier`.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { startSolidServer as startSparqPod } from "@jeswr/solid-server";
import { base64url, calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";
import { type ResourceFixture, seedPod } from "./seed.js";

export interface SolidTestAccount {
  webid: string;
  /** Origin of this identity's pod (one server instance per identity). */
  baseUrl: string;
  /**
   * Fetch authenticated as this identity. Fixed-owner mode: plain fetch (every request is
   * the owner anyway). OIDC mode: mints a fresh DPoP proof per request — proofs are
   * single-use (jti replay protection), so never reuse captured headers.
   */
  authFetch: typeof fetch;
  stop(): Promise<void>;
}

export interface SolidTestServer {
  /** Pod origin of the primary account (`accounts[0]`). */
  baseUrl: string;
  /** Every provisioned account, primary first. */
  accounts: SolidTestAccount[];
  /**
   * Boot an additional isolated identity (fresh pod on a fresh port). Fixed-owner mode
   * accepts an explicit WebID; OIDC mode mints the WebID at the account's dev issuer.
   */
  provisionAccount(webid?: string): Promise<SolidTestAccount>;
  stop(): Promise<void>;
}

export interface StartSolidServerOptions {
  /**
   * Resources to seed into the primary account's pod. Pass a factory when fixture bodies
   * need the (dynamically assigned) account WebID or pod origin.
   */
  seedFixtures?:
    | readonly ResourceFixture[]
    | ((account: SolidTestAccount) => readonly ResourceFixture[]);
  /** Verify real Solid-OIDC + DPoP credentials; anonymous requests stay anonymous. */
  oidc?: boolean;
  /** Fixed-owner mode only: WebID of the primary account. */
  ownerWebid?: string;
}

/** How many fresh ports to try when a probed-free port is taken before the server binds. */
const PORT_RETRIES = 3;
const TOKEN_LIFETIME_SECONDS = 300;
const TOKEN_REFRESH_MS = 60_000;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Probe a currently-free loopback TCP port (`listen(0)` + close). */
async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === "string") throw new Error("port probe failed");
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

/**
 * The sparq pod needs its `baseUrl` (the IRI space of every resource) fixed BEFORE it binds,
 * so listen-on-port-0 is not usable: probe a free port, then race to bind it.
 */
async function startPodOnFreePort(options: {
  ownerWebid: (baseUrl: string) => string;
  oidc: boolean;
}): Promise<{ pod: Awaited<ReturnType<typeof startSparqPod>>; baseUrl: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PORT_RETRIES; attempt += 1) {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const pod = await startSparqPod({
        port,
        baseUrl,
        ownerWebid: options.ownerWebid(baseUrl),
        oidc: options.oidc,
      });
      return { pod, baseUrl };
    } catch (error) {
      lastError = error;
      if (!isErrnoException(error) || error.code !== "EADDRINUSE") throw error;
    }
  }
  throw lastError;
}

async function closeNodeServer(server: Server): Promise<void> {
  // Proactively drop idle keep-alive sockets; plain close() waits out their timeout.
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function makeStopOnce(close: () => Promise<void>): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= close();
    return stopping;
  };
}

async function provisionFixedOwnerAccount(webid?: string): Promise<SolidTestAccount> {
  const { pod, baseUrl } = await startPodOnFreePort({
    // A locally dereferenceable default (tests can seed /profile/card to make it resolve).
    ownerWebid: (podBaseUrl) => webid ?? `${podBaseUrl}/profile/card#me`,
    oidc: false,
  });
  return {
    webid: webid ?? `${baseUrl}/profile/card#me`,
    baseUrl,
    authFetch: fetch,
    stop: makeStopOnce(() => closeNodeServer(pod)),
  };
}

/**
 * Local dev issuer for one identity: OIDC discovery + JWKS + a WebID document binding the
 * WebID to the issuer, plus `at+jwt` access-token minting and per-request DPoP proofs.
 * Lifted from sparq `packages/solid-server/test/oidc.test.mjs` (sparq-org/sparq @ 947480b0).
 */
async function createDevIssuerIdentity(): Promise<{
  webid: string;
  headers(method: string, htu: string): Promise<{ authorization: string; dpop: string }>;
  close(): Promise<void>;
}> {
  const issuerKeys = await generateKeyPair("ES256", { extractable: true });
  const issuerJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    alg: "ES256",
    kid: "issuer-signing-key",
    use: "sig",
  };

  let issuer = "";
  let webid = "";
  const identityServer = createServer((request, response) => {
    if (request.url === "/profile") {
      response.setHeader("content-type", "text/turtle");
      response.end(`<${webid}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .\n`);
      return;
    }
    if (request.url === "/.well-known/openid-configuration") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (request.url === "/jwks") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [issuerJwk] }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  // The issuer's own URL may be assigned by the OS — nothing references it before bind.
  await new Promise<void>((resolve, reject) => {
    identityServer.once("error", reject);
    identityServer.listen(0, "localhost", resolve);
  });
  const address = identityServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("dev issuer failed to bind a TCP port");
  }
  issuer = `http://localhost:${address.port}`;
  webid = `${issuer}/profile#me`;

  const dpopKeys = await generateKeyPair("ES256", { extractable: true });
  const dpopJwk = await exportJWK(dpopKeys.publicKey);
  const thumbprint = await calculateJwkThumbprint(dpopJwk);

  let cachedToken: { value: string; mintedAt: number } | undefined;
  async function accessToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken !== undefined && now - cachedToken.mintedAt < TOKEN_REFRESH_MS) {
      return cachedToken.value;
    }
    const seconds = Math.floor(now / 1000);
    const value = await new SignJWT({
      client_id: "https://app.example/client",
      cnf: { jkt: thumbprint },
      webid,
    })
      .setProtectedHeader({ alg: "ES256", kid: issuerJwk.kid })
      .setIssuer(issuer)
      .setAudience("solid")
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + TOKEN_LIFETIME_SECONDS)
      .sign(issuerKeys.privateKey);
    cachedToken = { value, mintedAt: now };
    return value;
  }

  return {
    webid,
    async headers(method, htu) {
      const token = await accessToken();
      const ath = base64url.encode(createHash("sha256").update(token, "ascii").digest());
      const proof = await new SignJWT({ ath, htm: method, htu, jti: randomUUID() })
        .setProtectedHeader({ alg: "ES256", jwk: dpopJwk, typ: "dpop+jwt" })
        .setIssuedAt()
        .sign(dpopKeys.privateKey);
      return { authorization: `DPoP ${token}`, dpop: proof };
    },
    close: makeStopOnce(() => closeNodeServer(identityServer)),
  };
}

async function provisionOidcAccount(webid?: string): Promise<SolidTestAccount> {
  if (webid !== undefined) {
    throw new Error(
      "oidc mode mints each account's WebID at its local dev issuer — an arbitrary WebID " +
        "cannot be served/verified. Omit the webid argument.",
    );
  }
  const identity = await createDevIssuerIdentity();
  let pod: Awaited<ReturnType<typeof startSparqPod>>;
  let baseUrl: string;
  try {
    ({ pod, baseUrl } = await startPodOnFreePort({
      ownerWebid: () => identity.webid,
      oidc: true,
    }));
  } catch (error) {
    await identity.close();
    throw error;
  }

  const authFetch: typeof fetch = async (input, init) => {
    // Merge input + init into one Request first so bodies, signals, redirect mode, etc.
    // survive; string/URL inputs may be pod-relative and resolve against this account's pod.
    const request = new Request(
      input instanceof Request ? input : new URL(String(input), `${baseUrl}/`),
      init,
    );
    const url = new URL(request.url);
    // RFC 9449: `htu` binds scheme/authority/path only (no query or fragment).
    const htu = `${url.origin}${url.pathname}`;
    const credentialHeaders = await identity.headers(request.method, htu);
    const headers = new Headers(request.headers);
    headers.set("authorization", credentialHeaders.authorization);
    headers.set("dpop", credentialHeaders.dpop);
    return fetch(new Request(request, { headers }));
  };

  return {
    webid: identity.webid,
    baseUrl,
    authFetch,
    stop: makeStopOnce(async () => {
      await closeNodeServer(pod);
      await identity.close();
    }),
  };
}

/**
 * Boot the dev/test Solid server (the sparq WASM implementation,
 * `@jeswr/solid-server`, vendored).
 */
export async function startSolidServer(
  options: StartSolidServerOptions = {},
): Promise<SolidTestServer> {
  const oidc = options.oidc === true;
  if (oidc && options.ownerWebid !== undefined) {
    throw new Error(
      "ownerWebid is a fixed-owner-mode option; oidc mode mints WebIDs at each account's " +
        "dev issuer",
    );
  }
  const accounts: SolidTestAccount[] = [];
  /**
   * In-flight provision lifecycles, awaited by stop() so no pod outlives it. A lifecycle
   * REJECTS only when late-account cleanup failed (a possible leak stop() must surface);
   * plain provisioning failures resolve to `undefined` — nothing live, only the caller
   * needs to hear about them (via `callerError`).
   */
  const inFlight = new Set<Promise<SolidTestAccount | undefined>>();
  let stopped = false;

  const provisionAccount = (webid?: string): Promise<SolidTestAccount> => {
    if (stopped) return Promise.reject(new Error("harness already stopped"));
    let callerError: unknown;
    const lifecycle = (async (): Promise<SolidTestAccount | undefined> => {
      let account: SolidTestAccount;
      try {
        account = oidc
          ? await provisionOidcAccount(webid)
          : await provisionFixedOwnerAccount(webid);
      } catch (error) {
        callerError = error;
        return undefined;
      }
      if (stopped) {
        // stop() ran while this account was booting: never hand out a live pod. A throw
        // from account.stop() rejects the lifecycle and so surfaces in stop().
        await account.stop();
        callerError = new Error("harness stopped while provisioning this account");
        return undefined;
      }
      accounts.push(account);
      return account;
    })();
    inFlight.add(lifecycle);
    const remove = () => {
      inFlight.delete(lifecycle);
    };
    void lifecycle.then(remove, remove);
    return lifecycle.then((account) => {
      if (account === undefined) throw callerError;
      return account;
    });
  };

  const primary = await provisionAccount(options.ownerWebid);
  const stop = makeStopOnce(async () => {
    stopped = true;
    // Let in-flight provisions finish their own push-or-cleanup, stop every provisioned
    // account, and only then throw — stop() must not resolve while a pod may still be
    // live, but neither may one bad shutdown short-circuit the rest, so everything is
    // allSettled first and failures are aggregated.
    const lifecycles = await Promise.allSettled([...inFlight]);
    const shutdowns = await Promise.allSettled(accounts.map((account) => account.stop()));
    const failures = [...lifecycles, ...shutdowns]
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      .map((outcome) => outcome.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "solid harness shutdown may have leaked a pod");
    }
  });

  try {
    if (options.seedFixtures !== undefined) {
      const fixtures =
        typeof options.seedFixtures === "function"
          ? options.seedFixtures(primary)
          : options.seedFixtures;
      await seedPod(primary.baseUrl, fixtures, {
        fetch: primary.authFetch,
        ownerWebid: primary.webid,
      });
    }
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseUrl: primary.baseUrl, accounts, provisionAccount, stop };
}
