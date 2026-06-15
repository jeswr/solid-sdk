/**
 * TEST-ONLY helpers for driving a headless CSS v8 OIDC interaction (login → pick-WebID → consent)
 * as an already-logged-in user, so a consumer's live test can exercise the REAL authorization-code
 * + PKCE + DPoP flow without a browser. This is the drive helper the SDK's own live spec uses,
 * factored out here (DRY: three consumers + the SDK all need it).
 *
 * Not part of the runtime auth surface — it is exported from the `@jeswr/solid-dpop/testing`
 * subpath, never from the package root. It assumes the caller has a session COOKIE for a logged-in
 * CSS account and the user's WebID (both provisioned by the consumer's vitest globalSetup).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { buildAuthorizationUrl, exchangeCode, generatePkce, } from "./authCode.js";
/**
 * Drive the in-flight CSS OIDC interaction headlessly as the logged-in user, returning the
 * authorization `code` + `state` delivered to the loopback listener. Mirrors the CSS v8 `.account`
 * prompt API: `login`/`select_account` → POST `controls.oidc.webId`; `consent` → POST
 * `controls.oidc.consent`; follow each step's `location` until the loopback redirect fires.
 */
export async function driveHeadlessOidc(ctx, authUrl, listener) {
    const { base, cookie, webId } = ctx;
    const jar = new Map();
    const ci = cookie.indexOf("=");
    jar.set(cookie.slice(0, ci), cookie.slice(ci + 1));
    const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const absorb = (res) => {
        for (const c of res.headers.getSetCookie?.() ?? []) {
            const kv = c.split(";")[0] ?? "";
            const i = kv.indexOf("=");
            if (i > 0)
                jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
        }
    };
    absorb(await fetch(authUrl, { redirect: "manual", headers: { cookie: cookieHeader() } }));
    const promptUrl = new URL(".account/oidc/prompt/", base).toString();
    const getPrompt = async () => (await fetch(promptUrl, {
        headers: { accept: "application/json", cookie: cookieHeader() },
    }).then((r) => r.json()));
    const follow = async (loc) => {
        let current = loc;
        for (let hop = 0; hop < 6 && current; hop += 1) {
            const u = new URL(current, base);
            if (u.hostname === "127.0.0.1") {
                await fetch(u.toString()); // browser hits the loopback redirect_uri
                return "done";
            }
            const r = await fetch(u, { redirect: "manual", headers: { cookie: cookieHeader() } });
            absorb(r);
            if (u.pathname.startsWith("/.account") && r.status === 200)
                return "more";
            current = r.headers.get("location") ?? undefined;
            if (u.pathname.startsWith("/.account") && !current)
                return "more";
        }
        return "more";
    };
    for (let step = 0; step < 6; step += 1) {
        const p = await getPrompt();
        if (p.prompt === "login" || p.prompt === "select_account") {
            const r = await fetch(p.controls.oidc.webId, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json",
                    cookie: cookieHeader(),
                },
                body: JSON.stringify({ webId, remember: true }),
            });
            absorb(r);
            if ((await follow((await r.json()).location)) === "done")
                break;
        }
        else if (p.prompt === "consent") {
            const r = await fetch(p.controls.oidc.consent, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json",
                    cookie: cookieHeader(),
                },
                body: JSON.stringify({ remember: true }),
            });
            absorb(r);
            if ((await follow((await r.json()).location)) === "done")
                break;
        }
        else {
            throw new Error(`Unexpected OIDC prompt: ${p.prompt}`);
        }
    }
    return listener.waitForCode(10_000);
}
/**
 * Run one full headless user-delegated login and return the resulting DPoP-bound {@link AuthCodeSession}.
 * Defaults `prompt=consent` because CSS only issues a refresh token (`offline_access`) when consent
 * is explicitly requested (discovered live in the SDK spec).
 */
export async function headlessLogin(ctx, meta, client, listener, opts = {}) {
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
    const { code, state: returnedState } = await driveHeadlessOidc(ctx, authUrl, listener);
    if (returnedState !== state) {
        throw new Error("State mismatch on authorization redirect (headless driver).");
    }
    return exchangeCode({
        meta,
        client,
        redirectUri: listener.redirectUri,
        code,
        codeVerifier: pkce.verifier,
    });
}
//# sourceMappingURL=testing.js.map