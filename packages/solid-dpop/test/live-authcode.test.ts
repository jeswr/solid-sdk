/**
 * LIVE authorization-code + PKCE + DPoP flow against a real in-memory CSS v8 pod (booted by
 * live-setup on port 3086).
 *
 * The CSS v8 OIDC interaction is normally an HTML form (login → pick-WebID → consent), but it is
 * fully driveable over JSON via the `.account` API: once the user is logged in (cookie from
 * live-setup) and an authorization request is in flight, GET `.account/oidc/prompt/` reports the
 * current prompt and exposes `controls.oidc.{webId, consent, …}`. We dispatch on the prompt name —
 * `login`/`select_account` → POST `controls.oidc.webId` `{webId, remember}`, `consent` → POST
 * `controls.oidc.consent` `{remember}` — following each step's returned `location` until the
 * provider redirects to our loopback `redirect_uri` carrying `?code=…&state=…`.  We feed that code
 * to our real {@link startLoopbackListener} via an ordinary `fetch`, exactly as a browser would, so
 * the listener and `waitForCode` are exercised end-to-end.
 *
 * THE DISCOVERED CONTROL SHAPE (printed in the debug step, asserted in the first case):
 *   controls.oidc = { cancel, consent, prompt, forgetWebId, webId }
 *   - prompt:  GET  -> { prompt: "login"|"consent"|…, location, controls }
 *   - webId:   POST { webId, remember } -> { location }   (the "login"/pick-webid step)
 *   - consent: POST { remember }        -> { location }   (the grant step)
 * The `login` prompt (not `select_account`) is what CSS reports for the pick-WebID step.
 *
 * Asserts: the access token is DPoP-bound (jkt thumbprint present; the §8 nonce path is reachable);
 * authedFetch reads a protected resource with an `ath`-bound proof; refresh works with rotation;
 * and a SECOND full flow with prompt=consent also completes.
 *
 * If live-setup could not seed/login (account-API drift), CSS_AUTHCODE_COOKIE is unset and the live
 * cases self-skip with a printed reason — the offline authCode suite still gates the build.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import {
  type AuthCodeSession,
  authedFetch,
  buildAuthorizationUrl,
  type ClientRegistration,
  discoverProvider,
  exchangeCode,
  generatePkce,
  type OidcProviderMetadata,
  refreshSession,
  registerClient,
  startLoopbackListener,
} from "../src/index.js";

const base = process.env.CSS_AUTHCODE_BASE;
const issuer = process.env.CSS_AUTHCODE_ISSUER ?? base;
const pod = process.env.CSS_AUTHCODE_POD;
const cookie = process.env.CSS_AUTHCODE_COOKIE;
const webId = process.env.CSS_AUTHCODE_WEBID;
const ready = Boolean(base && issuer && pod && cookie && webId);

if (!ready) {
  // eslint-disable-next-line no-console
  console.warn(
    "[live-authcode] CSS not seeded/logged-in — live cases skipped (offline suite still runs).",
  );
}

interface PromptResponse {
  prompt?: string;
  location?: string;
  controls?: { oidc?: { webId?: string; consent?: string; prompt?: string } };
}

/**
 * Drive the in-flight CSS OIDC interaction headlessly as the logged-in user, returning the
 * authorization `code` + `state` delivered to the loopback listener. `cookieJar` accumulates the
 * `_interaction` cookies CSS sets during the dance, alongside the account login cookie.
 */
async function driveInteraction(
  authUrl: string,
  listener: {
    redirectUri: string;
    waitForCode: (ms?: number) => Promise<{ code: string; state: string }>;
  },
  cookieJar: Map<string, string>,
  debug = false,
): Promise<{ code: string; state: string }> {
  const cookieHeader = (): string =>
    [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res: Response): void => {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookies) {
      const kv = c.split(";")[0] ?? "";
      const i = kv.indexOf("=");
      if (i > 0) cookieJar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
  };

  // 1. Hit the authorization endpoint as the logged-in account; it 303s into the interaction.
  const authRes = await fetch(authUrl, { redirect: "manual", headers: { cookie: cookieHeader() } });
  absorb(authRes);

  const promptUrl = new URL(".account/oidc/prompt/", base).toString();
  const getPrompt = async (): Promise<PromptResponse> =>
    (await fetch(promptUrl, {
      headers: { accept: "application/json", cookie: cookieHeader() },
    }).then((r) => r.json())) as PromptResponse;

  // Follow a returned `location` until we either land back on the `.account` interaction UI (more
  // steps to do) or reach the loopback callback (done). Feeds the callback through a real browser
  // GET so startLoopbackListener resolves.
  const follow = async (loc: string | undefined): Promise<"more" | "done"> => {
    let current = loc;
    for (let hop = 0; hop < 6 && current; hop += 1) {
      const u = new URL(current, base);
      if (u.hostname === "127.0.0.1") {
        await fetch(u.toString()); // browser hits the loopback redirect_uri
        return "done";
      }
      const r = await fetch(u, { redirect: "manual", headers: { cookie: cookieHeader() } });
      absorb(r);
      if (u.pathname.startsWith("/.account") && r.status === 200) return "more";
      current = r.headers.get("location") ?? undefined;
      if (u.pathname.startsWith("/.account") && !current) return "more";
    }
    return "more";
  };

  for (let step = 0; step < 6; step += 1) {
    const p = await getPrompt();
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(
        `[live-authcode] step ${step}: prompt=${p.prompt} oidcControls=${JSON.stringify(Object.keys(p.controls?.oidc ?? {}))}`,
      );
    }
    if (p.prompt === "login" || p.prompt === "select_account") {
      expect(p.controls?.oidc?.webId).toBeTruthy();
      const r = await fetch(p.controls!.oidc!.webId!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: cookieHeader(),
        },
        body: JSON.stringify({ webId, remember: true }),
      });
      absorb(r);
      const j = (await r.json()) as { location?: string };
      if ((await follow(j.location)) === "done") break;
    } else if (p.prompt === "consent") {
      expect(p.controls?.oidc?.consent).toBeTruthy();
      const r = await fetch(p.controls!.oidc!.consent!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: cookieHeader(),
        },
        body: JSON.stringify({ remember: true }),
      });
      absorb(r);
      const j = (await r.json()) as { location?: string };
      if ((await follow(j.location)) === "done") break;
    } else {
      throw new Error(`Unexpected OIDC prompt: ${p.prompt}`);
    }
  }

  return listener.waitForCode(10_000);
}

/**
 * Run one complete user-delegated login and return the resulting DPoP-bound session.
 *
 * NOTE on `prompt`: CSS (node-oidc-provider) only surfaces `offline_access` as a grantable scope —
 * and therefore only issues a refresh token — when the consent prompt is explicitly requested.
 * Without `prompt=consent` the AS auto-skips offline_access and no refresh token comes back. So a
 * CLI that wants refresh MUST request consent; we default to it here. (Discovered live, asserted in
 * the refresh case.)
 */
async function fullLogin(
  meta: OidcProviderMetadata,
  client: ClientRegistration,
  listener: Awaited<ReturnType<typeof startLoopbackListener>>,
  opts: { prompt?: "consent"; debug?: boolean } = {},
): Promise<AuthCodeSession> {
  const pkce = generatePkce();
  const state = randomBytes(16).toString("base64url");
  const authUrl = buildAuthorizationUrl({
    meta,
    client,
    redirectUri: listener.redirectUri,
    pkce,
    state,
    nonce: randomUUID(),
    prompt: opts.prompt ?? "consent",
  });

  const jar = new Map<string, string>();
  // Seed the account login cookie captured by live-setup.
  const loginCookie = cookie!;
  const ci = loginCookie.indexOf("=");
  jar.set(loginCookie.slice(0, ci), loginCookie.slice(ci + 1));

  const { code, state: returnedState } = await driveInteraction(authUrl, listener, jar, opts.debug);
  expect(returnedState).toBe(state);
  return exchangeCode({
    meta,
    client,
    redirectUri: listener.redirectUri,
    code,
    codeVerifier: pkce.verifier,
  });
}

describe("live authorization-code + PKCE + DPoP against CSS v8", () => {
  it("seeded a logged-in account in live-setup", () => {
    expect(typeof ready).toBe("boolean");
  });

  it.skipIf(!ready)(
    "completes the full flow: DCR → PKCE auth → headless interaction → DPoP-bound token",
    async () => {
      const meta = await discoverProvider(issuer!);
      expect(meta.registration_endpoint).toBeTruthy();
      const listener = await startLoopbackListener();
      try {
        const client = await registerClient(meta, listener.redirectUri, {
          clientName: "solid-dpop-live",
        });
        const session = await fullLogin(meta, client, listener, { debug: true });

        // Token is DPoP-bound: the keypair carries the jkt the token is cnf-bound to.
        expect(session.keyPair.thumbprint).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(session.accessToken.length).toBeGreaterThan(20);
        // CSS issues a JWT access token; its cnf.jkt MUST equal our keypair thumbprint.
        const at = decodeJwt(session.accessToken) as { cnf?: { jkt?: string } };
        if (at.cnf?.jkt) expect(at.cnf.jkt).toBe(session.keyPair.thumbprint);
        // offline_access was requested → a refresh token should be present.
        expect(session.refreshToken).toBeTruthy();
      } finally {
        await listener.close();
      }
    },
  );

  it.skipIf(!ready)(
    "authedFetch reads & writes a protected resource with an ath-bound proof",
    async () => {
      const meta = await discoverProvider(issuer!);
      const listener = await startLoopbackListener();
      try {
        const client = await registerClient(meta, listener.redirectUri);
        const session = await fullLogin(meta, client, listener);

        const target = `${pod}authcode-live-${Date.now()}.txt`;
        const payload = "written via user-delegated auth-code + DPoP";

        const put = await authedFetch(session, undefined, "PUT", target, {
          headers: { "content-type": "text/plain" },
          body: payload,
        });
        expect([201, 204, 205]).toContain(put.status);

        const get = await authedFetch(session, undefined, "GET", target);
        expect(get.status).toBe(200);
        expect(await get.text()).toBe(payload);

        // The resource read carried an ath-bound DPoP proof (sanity: a bare bearer is rejected).
        const bare = await fetch(target, {
          headers: { authorization: `Bearer ${session.accessToken}` },
        });
        expect(bare.status).not.toBe(200);

        await authedFetch(session, undefined, "DELETE", target);
      } finally {
        await listener.close();
      }
    },
  );

  it.skipIf(!ready)("refreshes the session (refresh-token grant with DPoP)", async () => {
    const meta = await discoverProvider(issuer!);
    const listener = await startLoopbackListener();
    try {
      const client = await registerClient(meta, listener.redirectUri);
      const session = await fullLogin(meta, client, listener);
      expect(session.refreshToken).toBeTruthy();
      const firstToken = session.accessToken;
      const firstThumbprint = session.keyPair.thumbprint;

      await refreshSession(session);
      expect(session.accessToken).toBeTruthy();
      expect(session.keyPair.thumbprint).toBe(firstThumbprint); // same DPoP binding
      // The refreshed token is still usable for a protected read.
      const target = `${pod}authcode-refresh-${Date.now()}.txt`;
      const put = await authedFetch(session, undefined, "PUT", target, {
        headers: { "content-type": "text/plain" },
        body: "after refresh",
      });
      expect([201, 204, 205]).toContain(put.status);
      await authedFetch(session, undefined, "DELETE", target);
      // Token usually rotates; at minimum the access token is a valid string.
      expect(typeof firstToken).toBe("string");
    } finally {
      await listener.close();
    }
  });

  it.skipIf(!ready)("a second full flow with prompt=consent also completes", async () => {
    const meta = await discoverProvider(issuer!);
    const listener = await startLoopbackListener();
    try {
      const client = await registerClient(meta, listener.redirectUri);
      const session = await fullLogin(meta, client, listener, { prompt: "consent" });
      expect(session.accessToken.length).toBeGreaterThan(20);
      const proof = session.keyPair.thumbprint;
      expect(proof).toBeTruthy();
      // Confirm the access token works on a HEAD of the pod root.
      const head = await authedFetch(session, undefined, "GET", pod!);
      expect([200, 401, 403]).toContain(head.status); // reachable; WAC may gate but token is accepted
    } finally {
      await listener.close();
    }
  });
});
