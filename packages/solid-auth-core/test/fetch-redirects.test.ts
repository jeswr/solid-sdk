// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { once } from "node:events";
import { createServer } from "node:http";
import * as DPoP from "dpop";
import * as oauth from "oauth4webapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSolidAuth, type LiveSession, WebIdDPoPTokenProvider } from "../src/controller.js";
import { type ProactiveFetchState, proactiveAuthenticatedFetch } from "../src/proactive-fetch.js";

const POD = "https://pod.example";
const SECOND = "https://second.example";
const FOREIGN = "https://foreign.example";
const ISSUER = "https://issuer.example";
const WEBID = `${POD}/profile/card#me`;
const CLIENT = "https://app.example/client";
const TOKEN = "synthetic-access-token";
type Wrapper = "controller" | "proactive";

/** Exercise real OAuth/DPoP code, stubbing only the OP's transport and popup. */
async function controllerFetch(
  base: typeof fetch,
  origins: string[],
  patchGlobalFetch = false,
  loggedIn = true,
) {
  let nonce = "";
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  const auth = createSolidAuth({
    callbackUri: "https://app.example/callback",
    clientId: CLIENT,
    allowedOrigins: origins,
    allowInsecureLoopback: true,
    patchGlobalFetch,
    profileFetch: async () =>
      new Response(`<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${ISSUER}>.`, {
        headers: { "Content-Type": "text/turtle" },
      }),
    authFlow: {
      getCode: async (url) => {
        nonce = url.searchParams.get("nonce") ?? "";
        return `https://app.example/callback?code=code&state=${url.searchParams.get("state")}`;
      },
    },
    publicFetch: async (input, init) => {
      const request =
        input instanceof Request && init === undefined ? input : new Request(input, init);
      const href = request.url;
      if (href === `${ISSUER}/.well-known/openid-configuration`) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          id_token_signing_alg_values_supported: ["ES256"],
        });
      }
      if (href === `${ISSUER}/token`) {
        const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const now = Math.floor(Date.now() / 1000);
        return json({
          access_token: TOKEN,
          token_type: "DPoP",
          expires_in: 3600,
          // oauth4webapi validates these claims without verifying this test ID token.
          id_token: `${b64({ alg: "ES256" })}.${b64({
            iss: ISSUER,
            sub: WEBID,
            webid: WEBID,
            aud: CLIENT,
            exp: now + 3600,
            iat: now,
            nonce,
          })}.c2lnbmF0dXJl`,
        });
      }
      return base(request);
    },
  });
  if (loggedIn) await auth.login(WEBID);
  return auth.authenticatedFetch;
}

async function wrappedFetch(
  kind: Wrapper,
  base: typeof fetch,
  origins = [POD, SECOND],
  loggedIn = true,
) {
  if (kind === "controller") return controllerFetch(base, origins, false, loggedIn);
  const dpopKey = await DPoP.generateKeyPair("ES256");
  const client: oauth.Client = { client_id: CLIENT };
  const session: LiveSession = {
    generation: 1,
    issuer: new URL(ISSUER),
    webId: WEBID,
    accessToken: TOKEN,
    dpopKey,
    dpopHandle: oauth.DPoP(client, dpopKey),
    authorizationServer: { issuer: ISSUER },
    client,
    allowedOrigins: new Set(origins),
  };
  const state = {
    provider: loggedIn
      ? new WebIdDPoPTokenProvider(
          () => session,
          async () => true,
        )
      : null,
    allowedOrigins: session.allowedOrigins,
  };
  return ((input, init) => proactiveAuthenticatedFetch(state, base, input, init)) as typeof fetch;
}

/** Model browser credential-header filtering without adding a browser runner. */
function stubRequestHeaderFiltering(shouldFilter: (request: Request) => boolean) {
  const NativeRequest = Request;
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init);
        if (shouldFilter(this)) {
          for (const header of ["Authorization", "DPoP", "Proxy-Authorization"]) {
            this.headers.delete(header);
          }
        }
      }
    },
  );
}

/** Verify the signature and token binding, as well as decoding the proof claims. */
async function proofOf(proof: string | null | undefined) {
  if (!proof) throw new Error("Expected a DPoP proof");
  const [header, payload, signature] = proof.split(".");
  const jwk = JSON.parse(Buffer.from(header, "base64url").toString()).jwk;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  expect(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  ).toBe(true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(claims.ath).toBe(
    Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).toString(
      "base64url",
    ),
  );
  return claims;
}

for (const kind of ["controller", "proactive"] as const) {
  describe(`${kind} browser Request modes`, () => {
    for (const loggedIn of [false, true]) {
      for (const init of [undefined, {}, { mode: "cors" as const }]) {
        it(`derives a navigation Request ${loggedIn ? "logged in" : "logged out"} (${JSON.stringify(init)})`, async () => {
          const sent: Request[] = [];
          const wrapped = await wrappedFetch(
            kind,
            async (input) => {
              sent.push(input as Request);
              return new Response("done");
            },
            [POD],
            loggedIn,
          );
          const request = new Request(`${POD}/start`, {
            referrer: "https://app.example/page",
            referrerPolicy: "no-referrer",
          });
          // Only the browser can originate a navigation Request (e.g. event.request).
          // Expose that inherited mode while retaining a real platform Request brand.
          Object.defineProperty(request, "mode", { value: "navigate" });
          expect(() => new Request(request, { mode: request.mode })).toThrow(TypeError);
          expect(await (await wrapped(request, init)).text()).toBe("done");
          expect(sent).toHaveLength(1);
          expect(sent[0].mode).toBe(init?.mode ?? "same-origin");
          expect(sent[0].referrer).toBe(request.referrer);
          expect(sent[0].referrerPolicy).toBe(request.referrerPolicy);
          expect(sent[0].redirect).toBe(loggedIn ? "manual" : "follow");
          expect(sent[0].headers.get("Authorization")).toBe(loggedIn ? `DPoP ${TOKEN}` : null);
          if (loggedIn) {
            expect(await proofOf(sent[0].headers.get("DPoP"))).toMatchObject({
              htu: `${POD}/start`,
              htm: "GET",
            });
          } else expect(sent[0].headers.has("DPoP")).toBe(false);
        });
      }

      for (const asRequest of [false, true]) {
        for (const callerCredentials of [false, true]) {
          it(`keeps no-cors uncredentialed ${loggedIn ? "logged in" : "logged out"} (${asRequest ? "Request" : "init"}, ${callerCredentials ? "filtered caller credentials" : "no credentials"})`, async () => {
            const sent: Request[] = [];
            const result = new Response("public");
            const redirectError = new TypeError("no-cors requires redirect follow");
            const wrapped = await wrappedFetch(
              kind,
              async (input) => {
                const request = input as Request;
                sent.push(request);
                expect(request.mode).toBe("no-cors");
                expect(await request.text()).toBe("public body");
                for (const header of ["Authorization", "DPoP", "Proxy-Authorization"]) {
                  expect(request.headers.has(header)).toBe(false);
                }
                // Browsers reject no-cors with non-follow redirect policies at fetch.
                if (request.redirect !== "follow") throw redirectError;
                return result;
              },
              [POD],
              loggedIn,
            );
            const upgrade = vi.spyOn(WebIdDPoPTokenProvider.prototype, "upgrade");
            stubRequestHeaderFiltering((request) => request.mode === "no-cors");
            try {
              for (const redirect of ["follow", "error", "manual"] as const) {
                const init: RequestInit = {
                  method: "POST",
                  mode: "no-cors",
                  body: "public body",
                  redirect,
                  ...(callerCredentials
                    ? {
                        headers: {
                          Authorization: "Bearer caller-token",
                          DPoP: "caller-proof",
                          "Proxy-Authorization": "Basic caller-proxy",
                        },
                      }
                    : {}),
                };
                const pending = asRequest
                  ? wrapped(new Request(`${POD}/start`, init))
                  : wrapped(`${POD}/start`, init);
                if (redirect === "follow") expect(await pending).toBe(result);
                else await expect(pending).rejects.toBe(redirectError);
                expect(sent.at(-1)?.redirect).toBe(redirect);
              }
              expect(sent).toHaveLength(3);
              expect(upgrade).not.toHaveBeenCalled();
            } finally {
              vi.unstubAllGlobals();
              upgrade.mockRestore();
            }
          });
        }
      }
    }

    for (const retry of [false, true]) {
      for (const redirect of ["follow", "error", "manual"] as const) {
        it(`keeps ${redirect} when constructed headers filter SDK credentials on the ${retry ? "retry" : "first upgrade"}`, async () => {
          const sent: Request[] = [];
          const result = new Response("unfollowed", {
            status: 307,
            headers: { Location: "/next" },
          });
          const wrapped = await wrappedFetch(kind, async (input) => {
            sent.push(input as Request);
            return retry && sent.length === 1 ? new Response(null, { status: 401 }) : result;
          });
          const upgrade = vi.spyOn(WebIdDPoPTokenProvider.prototype, "upgrade");
          // Exercise read-back after construction independently of the no-cors bypass.
          stubRequestHeaderFiltering(() => !retry || upgrade.mock.calls.length === 2);
          try {
            expect(await wrapped(`${POD}/start`, { redirect })).toBe(result);
            expect(sent).toHaveLength(retry ? 2 : 1);
            expect(upgrade).toHaveBeenCalledTimes(retry ? 2 : 1);
            if (retry) {
              expect(sent[0].redirect).toBe("manual");
              expect(sent[0].headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
            }
            const filtered = sent.at(-1);
            expect(filtered?.redirect).toBe(redirect);
            expect(filtered?.headers.has("Authorization")).toBe(false);
            expect(filtered?.headers.has("DPoP")).toBe(false);
            expect(await result.text()).toBe("unfollowed");
          } finally {
            vi.unstubAllGlobals();
            upgrade.mockRestore();
          }
        });
      }
    }
  });

  describe(`${kind} credentialed redirects (injected transport)`, () => {
    for (const route of [
      "public passthrough",
      "caller-credential passthrough",
      "declined-upgrade fallback",
      "credentialed first send",
      "same-origin 307 hop",
      "same-origin 303 rewrite",
    ] as const) {
      for (const inputKind of ["init", "Request", "Request with init"] as const) {
        it(`preserves caller Request properties on ${route} (${inputKind})`, async () => {
          const sent: Request[] = [];
          const bodies: string[] = [];
          const followed = route === "same-origin 307 hop" || route === "same-origin 303 rewrite";
          const wrapped = await wrappedFetch(kind, async (input, init) => {
            // Inspect the actual transport argument: reconstructing it here can itself
            // reset referrer settings and conceal which SDK derivation dropped them.
            expect(input).toBeInstanceOf(Request);
            expect(init).toBeUndefined();
            const request = input as Request;
            sent.push(request);
            bodies.push(await request.text());
            return followed && sent.length === 1
              ? new Response(null, {
                  status: route === "same-origin 303 rewrite" ? 303 : 307,
                  headers: { Location: "/final" },
                })
              : new Response("done");
          });
          const abort = new AbortController();
          const hasBody = inputKind === "init" || route === "same-origin 303 rewrite";
          const settings: RequestInit = {
            referrer: "https://app.example/private/page",
            referrerPolicy: "no-referrer",
            mode: "same-origin",
            credentials: "omit",
            cache: "no-store",
            integrity: "sha256-synthetic",
            keepalive: true,
            signal: abort.signal,
            priority: "high",
            redirect: "follow",
            headers: {
              "X-Caller": "kept",
              ...(route === "caller-credential passthrough"
                ? { Authorization: "Bearer caller-owned" }
                : {}),
            },
            ...(hasBody ? { method: "POST", body: "caller body" } : {}),
          };
          const url = `${route.endsWith("passthrough") ? FOREIGN : POD}/start`;
          const upgrade = vi.spyOn(WebIdDPoPTokenProvider.prototype, "upgrade");
          if (route === "declined-upgrade fallback") {
            upgrade.mockImplementationOnce(async (request) => request);
          }
          try {
            const response =
              inputKind === "init"
                ? await wrapped(url, settings)
                : await wrapped(
                    new Request(url, settings),
                    inputKind === "Request with init" ? { headers: settings.headers } : undefined,
                  );
            expect(await response.text()).toBe("done");
            expect(sent.map((request) => request.url)).toEqual(
              followed ? [url, `${POD}/final`] : [url],
            );
            const credentialed = route === "credentialed first send" || followed;
            for (const [index, request] of sent.entries()) {
              for (const key of [
                "referrer",
                "referrerPolicy",
                "mode",
                "credentials",
                "cache",
                "integrity",
                "keepalive",
              ] as const) {
                expect(request[key], key).toBe(settings[key]);
              }
              if ("priority" in Request.prototype) {
                expect(Reflect.get(request, "priority")).toBe("high");
              }
              expect(request.redirect).toBe(
                credentialed || route === "caller-credential passthrough" ? "manual" : "follow",
              );
              expect(request.headers.get("X-Caller")).toBe("kept");
              expect(request.headers.get("Authorization")).toBe(
                credentialed
                  ? `DPoP ${TOKEN}`
                  : route === "caller-credential passthrough"
                    ? "Bearer caller-owned"
                    : null,
              );
              const rewritten = index === 1 && route === "same-origin 303 rewrite";
              expect(request.method).toBe(hasBody && !rewritten ? "POST" : "GET");
              expect(bodies[index]).toBe(hasBody && !rewritten ? "caller body" : "");
              if (rewritten) expect(request.headers.has("Content-Type")).toBe(false);
              expect(request.signal.aborted).toBe(false);
            }
            const reason = new Error("caller cancelled");
            abort.abort(reason);
            for (const request of sent) {
              expect(request.signal.aborted).toBe(true);
              expect(request.signal.reason).toBe(reason);
            }
          } finally {
            upgrade.mockRestore();
          }
        });
      }
    }

    for (const [status, method, nextMethod] of [
      [301, "POST", "GET"],
      [302, "POST", "GET"],
      [303, "PATCH", "GET"],
      [303, "HEAD", "HEAD"],
      [307, "POST", "POST"],
      [308, "PUT", "PUT"],
      [301, "PUT", "PUT"],
      [302, "PATCH", "PATCH"],
    ] as const) {
      it(`${status} ${method} follows with ${nextMethod} and a fresh bound proof`, async () => {
        const sent: { request: Request; body: string }[] = [];
        const wrapped = await wrappedFetch(kind, async (input, init) => {
          const request = new Request(input, init);
          expect(request.redirect).toBe("manual");
          sent.push({ request, body: await request.text() });
          return sent.length === 1
            ? new Response("redirect", { status, headers: { Location: "./final?q=1#part" } })
            : new Response("done");
        });
        const hasBody = method !== "HEAD";
        expect(
          await (
            await wrapped(`${POD}/start`, {
              method,
              ...(hasBody
                ? {
                    body: "ABC",
                    headers: { "Content-Type": "text/plain", "Content-Length": "3" },
                  }
                : {}),
              redirect: "follow",
            })
          ).text(),
        ).toBe("done");
        expect(sent).toHaveLength(2);
        expect(sent[1].request.url).toBe(`${POD}/final?q=1#part`);
        expect(sent[1].request.method).toBe(nextMethod);
        expect(sent[1].body).toBe(nextMethod === "GET" || !hasBody ? "" : "ABC");
        if (hasBody) {
          expect(sent[0].request.headers.get("Content-Length")).toBe("3");
          expect(sent[1].request.headers.get("Content-Length")).toBe(
            nextMethod === "GET" ? null : "3",
          );
        }
        if (nextMethod === "GET") expect(sent[1].request.headers.has("Content-Type")).toBe(false);
        const proofs = await Promise.all(
          sent.map(({ request }) => proofOf(request.headers.get("DPoP"))),
        );
        expect(proofs[0]).toMatchObject({ htu: `${POD}/start`, htm: method });
        expect(proofs[1]).toMatchObject({ htu: `${POD}/final`, htm: nextMethod });
        expect(proofs[1].jti).not.toBe(proofs[0].jti);
        for (const { request } of sent) {
          expect(request.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
        }
      });
    }

    it("returns a foreign redirect response unchanged, including its readable body", async () => {
      const redirect = new Response("caller decides", {
        status: 302,
        headers: { Location: `${FOREIGN}/steal`, "X-Original": "kept" },
      });
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return redirect;
      });
      const response = await wrapped(`${POD}/start`, { redirect: "follow" });
      expect(response).toBe(redirect);
      expect(response.headers.get("Location")).toBe(`${FOREIGN}/steal`);
      expect(response.headers.get("X-Original")).toBe("kept");
      expect(await response.text()).toBe("caller decides");
      expect(calls).toBe(1);
    });

    for (const location of [
      "https://user:password@pod.example/final",
      "mailto:someone@example.com",
      "http://[invalid",
    ]) {
      it(`returns an unrequestable Location (${location}) untouched`, async () => {
        const redirect = new Response("still readable", {
          status: 302,
          headers: { Location: location },
        });
        let calls = 0;
        const wrapped = await wrappedFetch(kind, async () => {
          calls++;
          return redirect;
        });
        const response = await wrapped(`${POD}/start`);
        expect(response).toBe(redirect);
        expect(calls).toBe(1);
        expect(response.bodyUsed).toBe(false);
        expect(response.redirected).toBe(false);
        expect(response.headers.get("Location")).toBe(location);
        expect(await response.text()).toBe("still readable");
      });
    }

    for (const asRequest of [false, true]) {
      it(`strips origin-bound headers only when the origin changes (${asRequest ? "Request" : "init"})`, async () => {
        const sent: Request[] = [];
        const wrapped = await wrappedFetch(kind, async (input, init) => {
          sent.push(new Request(input, init));
          const locations = ["/middle", `${SECOND}/final`, `${POD}/back`];
          return sent.length <= locations.length
            ? new Response(null, { status: 302, headers: { Location: locations[sent.length - 1] } })
            : new Response("done");
        });
        const init = {
          headers: {
            Cookie: "session=caller",
            Cookie2: "legacy=caller",
            "Proxy-Authorization": "Basic caller-proxy",
            Authorization: "Bearer caller-token",
            DPoP: "caller-proof",
            "X-Ordinary": "preserved",
          },
        };
        if (asRequest) await wrapped(new Request(`${POD}/start`, init));
        else await wrapped(`${POD}/start`, init);
        expect(sent.map((request) => request.url)).toEqual([
          `${POD}/start`,
          `${POD}/middle`,
          `${SECOND}/final`,
          `${POD}/back`,
        ]);
        for (const [index, request] of sent.entries()) {
          for (const header of ["Cookie", "Cookie2", "Proxy-Authorization"] as const) {
            expect(request.headers.get(header)).toBe(index < 2 ? init.headers[header] : null);
          }
          expect(request.headers.get("X-Ordinary")).toBe("preserved");
          expect(request.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
          const proof = await proofOf(request.headers.get("DPoP"));
          expect(proof.htu).toBe(request.url);
        }
      });

      for (const header of ["Authorization", "DPoP", "Proxy-Authorization"]) {
        it(`returns caller ${header} passthrough redirects unfollowed (${asRequest ? "Request" : "init"})`, async () => {
          const sent: Request[] = [];
          const responses: Response[] = [];
          const wrapped = await wrappedFetch(kind, async (input, init) => {
            sent.push(new Request(input, init));
            const response = new Response("caller decides", {
              status: 302,
              headers: { Location: "/next" },
            });
            responses.push(response);
            return response;
          });
          for (const redirect of ["follow", "error", "manual"] as const) {
            const init = { headers: { [header.toLowerCase()]: "caller-owned" }, redirect };
            const response = asRequest
              ? await wrapped(new Request(`${FOREIGN}/start`, init))
              : await wrapped(`${FOREIGN}/start`, init);
            expect(response).toBe(responses.at(-1));
            expect(response.bodyUsed).toBe(false);
            expect(await response.text()).toBe("caller decides");
          }
          expect(sent).toHaveLength(3);
          for (const request of sent) {
            expect(request.url).toBe(`${FOREIGN}/start`);
            expect(request.redirect).toBe("manual");
            expect(request.headers.get(header)).toBe("caller-owned");
          }
        });
      }
    }

    it("caps a loop at 20 followed hops", async () => {
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return new Response(null, { status: 302, headers: { Location: "/again" } });
      });
      await expect(wrapped(`${POD}/start`)).rejects.toThrow(TypeError);
      expect(calls).toBe(21);
    });

    it("allows exactly 20 hops and stops at a redirect without Location", async () => {
      let calls = 0;
      const last = new Response("no location", { status: 302 });
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return calls === 21
          ? last
          : new Response(null, { status: 308, headers: { Location: "/again" } });
      });
      expect(await wrapped(`${POD}/start`, { redirect: "error" })).toBe(last);
      expect(calls).toBe(21);
    });

    it("checks an allowlisted hop before refusing its foreign redirect", async () => {
      const sent: Request[] = [];
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        sent.push(new Request(input, init));
        return new Response("redirect", {
          status: 302,
          headers: { Location: sent.length === 1 ? `${SECOND}/middle` : `${FOREIGN}/end` },
        });
      });
      expect((await wrapped(`${POD}/start`)).headers.get("Location")).toBe(`${FOREIGN}/end`);
      expect(sent.map((request) => request.url)).toEqual([`${POD}/start`, `${SECOND}/middle`]);
      const first = await proofOf(sent[0].headers.get("DPoP"));
      const next = await proofOf(sent[1].headers.get("DPoP"));
      expect(next).toMatchObject({ htu: `${SECOND}/middle`, htm: "GET" });
      expect(next.jti).not.toBe(first.jti);
    });

    it("reports followed hops on a final unfollowed redirect and its clones", async () => {
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return new Response("redirect body", {
          status: 302,
          headers: { Location: calls === 1 ? `${SECOND}/middle?q=1#part` : `${FOREIGN}/end` },
        });
      });
      const response = await wrapped(`${POD}/start`);
      const clone = response.clone();
      const nestedClone = clone.clone();
      for (const result of [response, clone, nestedClone]) {
        expect(result).toBeInstanceOf(Response);
        expect(result.redirected).toBe(true);
        expect(result.url).toBe(`${SECOND}/middle?q=1`);
        expect(Object.getOwnPropertyDescriptor(result, "redirected")?.get).toBeTypeOf("function");
        expect(Object.getOwnPropertyDescriptor(result, "url")?.get).toBeTypeOf("function");
        expect(await result.text()).toBe("redirect body");
      }
      expect(calls).toBe(2);
      expect(() => response.clone()).toThrow(TypeError);
    });

    for (const timing of ["before", "during"] as const) {
      for (const customReason of [false, true]) {
        it(`aborts ${timing} body buffering with the ${customReason ? "custom" : "default"} signal reason`, async () => {
          const base = vi.fn<typeof fetch>();
          const wrapped = await wrappedFetch(kind, base);
          const abort = new AbortController();
          let reading!: () => void;
          const started = new Promise<void>((resolve) => {
            reading = resolve;
          });
          // Cancellation itself may stall; rejecting fetch must not wait for it.
          const cancel = vi.fn(() => new Promise<void>(() => {}));
          const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
            {
              pull() {
                reading();
                return new Promise<void>(() => {});
              },
              cancel,
            },
            { highWaterMark: 0 },
          );
          class StalledBlob extends Blob {
            override stream() {
              return stream;
            }
          }
          const reason = customReason
            ? new DOMException("cancel buffering", "AbortError")
            : undefined;
          if (timing === "before") abort.abort(reason);
          const pending = wrapped(`${POD}/start`, {
            method: "POST",
            body: new StalledBlob(["ABC"]),
            signal: abort.signal,
          });
          if (timing === "during") {
            await started;
            abort.abort(reason);
          }
          await expect(pending).rejects.toBe(abort.signal.reason);
          expect(abort.signal.reason.name).toBe("AbortError");
          expect(base).not.toHaveBeenCalled();
          if (timing === "during")
            expect(cancel).toHaveBeenCalledExactlyOnceWith(abort.signal.reason);
        });
      }
    }

    for (const bodyKind of ["bytes", "blob", "params", "form"] as const) {
      it(`replays a buffered ${bodyKind} body without changing its content type or bytes`, async () => {
        const form = new FormData();
        form.set("key", "value");
        const bodies = {
          bytes: new Uint8Array([0, 1, 255]),
          blob: new Blob(["payload"], { type: "text/custom" }),
          params: new URLSearchParams({ key: "value" }),
          form,
        };
        const sent: { bytes: number[]; type: string | null }[] = [];
        const wrapped = await wrappedFetch(kind, async (input, init) => {
          const request = new Request(input, init);
          sent.push({
            bytes: [...new Uint8Array(await request.arrayBuffer())],
            type: request.headers.get("Content-Type"),
          });
          return sent.length === 1
            ? new Response(null, { status: 307, headers: { Location: "/final" } })
            : new Response("done");
        });
        await wrapped(`${POD}/start`, { method: "POST", body: bodies[bodyKind] });
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        expect(sent[1].bytes.length).toBeGreaterThan(0);
      });
    }

    it("can discard a streaming POST body on 303", async () => {
      const sent: Request[] = [];
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        const request = new Request(input, init);
        sent.push(request);
        await request.text();
        return sent.length === 1
          ? new Response(null, { status: 303, headers: { Location: "/final" } })
          : new Response("done");
      });
      const init = {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("ABC"));
            controller.close();
          },
        }),
        duplex: "half",
      };
      await wrapped(`${POD}/start`, init);
      expect(sent).toHaveLength(2);
      expect(sent[1].method).toBe("GET");
      expect(sent[1].body).toBeNull();
      expect(sent[1].headers.has("Content-Type")).toBe(false);
    });

    for (const asRequest of [false, true]) {
      for (const status of [307, 308]) {
        it(`returns ${status} unfollowed for ${asRequest ? "Request" : "ReadableStream"} bodies`, async () => {
          let calls = 0;
          const redirect = new Response("unfollowed", { status, headers: { Location: "/final" } });
          const wrapped = await wrappedFetch(kind, async (input, init) => {
            const request = new Request(input, init);
            expect(request.redirect).toBe("manual");
            expect(await request.text()).toBe("ABC");
            calls++;
            return redirect;
          });
          const init = {
            method: "POST",
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("ABC"));
                controller.close();
              },
            }),
            duplex: "half",
          };
          const response = asRequest
            ? await wrapped(new Request(`${POD}/start`, { method: "POST", body: "ABC" }))
            : await wrapped(`${POD}/start`, init);
          expect(response).toBe(redirect);
          expect(calls).toBe(1);
        });
      }
    }

    it("returns an opaqueredirect as-is without reading Location", async () => {
      // Even if an injected transport exposes redirect details on this type,
      // the wrapper must leave them untouched instead of trying to follow.
      const opaque = new Response(null, { status: 302, headers: { Location: "/hidden" } });
      Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return opaque;
      });
      expect(await wrapped(`${POD}/start`)).toBe(opaque);
      expect(calls).toBe(1);
    });

    it("keeps the caller's redirect policy on public requests", async () => {
      const policies: RequestRedirect[] = [];
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        const request = new Request(input, init);
        policies.push(request.redirect);
        expect(request.headers.has("Authorization")).toBe(false);
        expect(request.headers.has("DPoP")).toBe(false);
        return new Response("public");
      });
      await wrapped(`${FOREIGN}/public`, { redirect: "follow" });
      await wrapped(`${FOREIGN}/public`, { redirect: "error" });
      expect(policies).toEqual(["follow", "error"]);
    });

    for (const retry of [false, true]) {
      for (const redirect of ["follow", "error", "manual"] as const) {
        it(`keeps ${redirect} when the provider declines credentials on the ${retry ? "retry" : "first upgrade"}`, async () => {
          const sent: Request[] = [];
          const result = new Response("public", {
            status: redirect === "manual" ? 307 : 200,
            headers: { Location: "/next" },
          });
          const redirectError = new TypeError("redirect disallowed");
          const wrapped = await wrappedFetch(kind, async (input, init) => {
            const request = new Request(input, init);
            sent.push(request);
            expect(await request.text()).toBe("ABC");
            if (retry && sent.length === 1) {
              expect(request.redirect).toBe("manual");
              expect(request.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
              upgrade.mockImplementationOnce(async (source) => source);
              return new Response(null, { status: 401 });
            }
            expect(request.redirect).toBe(redirect);
            expect(request.headers.has("Authorization")).toBe(false);
            expect(request.headers.has("DPoP")).toBe(false);
            if (request.redirect === "error") throw redirectError;
            return result;
          });
          const upgrade = vi.spyOn(WebIdDPoPTokenProvider.prototype, "upgrade");
          if (!retry) upgrade.mockImplementationOnce(async (source) => source);
          try {
            const pending = wrapped(`${POD}/start`, { method: "POST", body: "ABC", redirect });
            if (redirect === "error") await expect(pending).rejects.toBe(redirectError);
            else expect(await pending).toBe(result);
            expect(sent).toHaveLength(retry ? 2 : 1);
          } finally {
            upgrade.mockRestore();
          }
        });
      }
    }

    it("keeps a later credential-free fallback's native follow policy and final response URL", async () => {
      const sent: Request[] = [];
      const result = new Response("public final");
      Object.defineProperties(result, {
        url: { configurable: true, value: `${FOREIGN}/final` },
        redirected: { configurable: true, value: true },
      });
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        const request = new Request(input, init);
        sent.push(request);
        if (sent.length === 1) {
          expect(request.redirect).toBe("manual");
          expect(request.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
          upgrade.mockImplementationOnce(async (source) => source);
          return new Response(null, { status: 302, headers: { Location: "/middle" } });
        }
        expect(request.url).toBe(`${POD}/middle`);
        expect(request.redirect).toBe("follow");
        expect(request.headers.has("Authorization")).toBe(false);
        expect(request.headers.has("DPoP")).toBe(false);
        return result;
      });
      const upgrade = vi.spyOn(WebIdDPoPTokenProvider.prototype, "upgrade");
      try {
        const response = await wrapped(`${POD}/start`, { redirect: "follow" });
        expect(response).toBe(result);
        for (const final of [response, response.clone()]) {
          expect(final.url).toBe(`${FOREIGN}/final`);
          expect(final.redirected).toBe(true);
          expect(await final.text()).toBe("public final");
        }
        expect(sent).toHaveLength(2);
      } finally {
        upgrade.mockRestore();
      }
    });

    it("returns caller credentials unfollowed when upgrade declines to replace them", async () => {
      const sent: Request[] = [];
      const result = new Response("caller decides", {
        status: 307,
        headers: { Location: "/next" },
      });
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        sent.push(new Request(input, init));
        return result;
      });
      const upgrade = vi
        .spyOn(WebIdDPoPTokenProvider.prototype, "upgrade")
        .mockImplementationOnce(async (source) => source);
      try {
        expect(
          await wrapped(`${POD}/start`, {
            headers: { Authorization: "Bearer caller-token", DPoP: "caller-proof" },
            redirect: "follow",
          }),
        ).toBe(result);
        expect(sent).toHaveLength(1);
        expect(sent[0].redirect).toBe("manual");
        expect(sent[0].headers.get("Authorization")).toBe("Bearer caller-token");
        expect(sent[0].headers.get("DPoP")).toBe("caller-proof");
      } finally {
        upgrade.mockRestore();
      }
    });
  });
}

describe("controller caller credentials before login", () => {
  for (const header of ["Authorization", "DPoP", "Proxy-Authorization"]) {
    for (const asRequest of [false, true]) {
      it(`returns ${header} redirects unfollowed (${asRequest ? "Request" : "init"})`, async () => {
        const sent: Request[] = [];
        const redirect = new Response("caller decides", {
          status: 302,
          headers: { Location: "/next" },
        });
        const auth = createSolidAuth({
          callbackUri: "https://app.example/callback",
          clientId: CLIENT,
          authFlow: {
            getCode: async () => {
              throw new Error("unexpected login");
            },
          },
          publicFetch: async (input, init) => {
            sent.push(new Request(input, init));
            return redirect;
          },
        });
        const init = { headers: { [header]: "caller-owned" }, redirect: "follow" as const };
        const response = asRequest
          ? await auth.authenticatedFetch(new Request(`${POD}/start`, init))
          : await auth.authenticatedFetch(`${POD}/start`, init);
        expect(response).toBe(redirect);
        expect(response.bodyUsed).toBe(false);
        expect(await response.text()).toBe("caller decides");
        expect(sent).toHaveLength(1);
        expect(sent[0].redirect).toBe("manual");
        expect(sent[0].headers.get(header)).toBe("caller-owned");
      });
    }
  }
});

describe("proactive caller-credential passthrough and fallback routes", () => {
  for (const route of [
    "no-provider",
    "empty-origins",
    "issuer-bypass",
    "liveness",
    "hop-gate",
    "first-reset",
    "first-unchanged",
    "retry-gate",
    "retry-reset",
    "retry-unchanged",
  ] as const) {
    for (const asRequest of [false, true]) {
      it(`${route} returns caller credentials unfollowed (${asRequest ? "Request" : "init"})`, async () => {
        let upgrades = 0;
        const provider = {
          async upgrade(request: Request) {
            upgrades++;
            if (
              (route === "first-unchanged" && upgrades === 1) ||
              (route === "retry-unchanged" && upgrades === 2)
            ) {
              return request;
            }
            if (
              (route === "first-reset" && upgrades === 1) ||
              (route === "retry-reset" && upgrades === 2)
            ) {
              await request.text();
              throw Object.assign(new Error("superseded"), { name: "ReactiveAuthResetError" });
            }
            const headers = new Headers(request.headers);
            headers.set("Authorization", "DPoP sdk-token");
            headers.set("DPoP", "sdk-proof");
            return new Request(request, { headers });
          },
        };
        let gateCalls = 0;
        const state: ProactiveFetchState = {
          provider: route === "no-provider" ? null : provider,
          allowedOrigins: new Set(route === "empty-origins" ? [] : [POD]),
          ...(route === "issuer-bypass" ? { issuerOrigins: new Set([POD]) } : {}),
          canAttachNonInteractively: () => {
            gateCalls++;
            return !(
              route === "liveness" ||
              (route === "hop-gate" && gateCalls === 2) ||
              (route === "retry-gate" && gateCalls === 3)
            );
          },
        };
        const sent: { request: Request; body: string }[] = [];
        const redirect = new Response("unfollowed", {
          status: 307,
          headers: { Location: "/next" },
        });
        const base: typeof fetch = async (input, init) => {
          const request = new Request(input, init);
          sent.push({ request, body: await request.text() });
          if (route.startsWith("retry-") && sent.length === 1) {
            return new Response(null, { status: 401 });
          }
          return redirect;
        };
        const init = {
          method: "POST",
          body: "caller body",
          headers: {
            Authorization: "Bearer caller-token",
            DPoP: "caller-proof",
            "Proxy-Authorization": "Basic caller-proxy",
          },
          redirect: "follow" as const,
        };
        const response = asRequest
          ? await proactiveAuthenticatedFetch(state, base, new Request(`${POD}/start`, init))
          : await proactiveAuthenticatedFetch(state, base, `${POD}/start`, init);
        expect(response).toBe(redirect);
        expect(response.bodyUsed).toBe(false);
        expect(await response.text()).toBe("unfollowed");
        expect(sent).toHaveLength(route.startsWith("retry-") ? 2 : 1);
        const fallback = sent.at(-1);
        expect(fallback?.request.redirect).toBe("manual");
        expect(fallback?.body).toBe("caller body");
        for (const [header, value] of Object.entries(init.headers)) {
          expect(fallback?.request.headers.get(header)).toBe(value);
        }
        expect(upgrades).toBe(
          route === "retry-reset" || route === "retry-unchanged"
            ? 2
            : route === "first-reset" || route === "first-unchanged" || route === "retry-gate"
              ? 1
              : 0,
        );
      });
    }
  }
});

describe("proactive credential-free passthrough and fallback routes", () => {
  for (const route of [
    "no-provider",
    "empty-origins",
    "issuer-bypass",
    "liveness",
    "hop-gate",
    "first-reset",
    "first-unchanged",
    "retry-gate",
    "retry-reset",
    "retry-unchanged",
  ] as const) {
    for (const redirect of ["follow", "error", "manual"] as const) {
      for (const asRequest of [false, true]) {
        it(`${route} keeps caller policy on credential-free ${redirect} (${asRequest ? "Request" : "init"})`, async () => {
          let upgrades = 0;
          const provider = {
            async upgrade(request: Request) {
              upgrades++;
              if (
                (route === "first-reset" && upgrades === 1) ||
                (route === "retry-reset" && upgrades === 2)
              ) {
                await request.text();
                throw Object.assign(new Error("superseded"), { name: "ReactiveAuthResetError" });
              }
              if (
                (route === "first-unchanged" && upgrades === 1) ||
                (route === "retry-unchanged" && upgrades === 2)
              ) {
                return request;
              }
              const headers = new Headers(request.headers);
              headers.set("Authorization", "DPoP sdk-token");
              headers.set("DPoP", "sdk-proof");
              return new Request(request, { headers });
            },
          };
          let gateCalls = 0;
          const state: ProactiveFetchState = {
            provider: route === "no-provider" ? null : provider,
            allowedOrigins: new Set(route === "empty-origins" ? [] : [POD]),
            ...(route === "issuer-bypass" ? { issuerOrigins: new Set([POD]) } : {}),
            canAttachNonInteractively: () => {
              gateCalls++;
              return !(
                route === "liveness" ||
                (route === "hop-gate" && gateCalls === 2) ||
                (route === "retry-gate" && gateCalls === 3)
              );
            },
          };
          const sent: Request[] = [];
          const result = new Response("public", {
            status: redirect === "manual" ? 307 : 200,
            headers: { Location: "/next" },
          });
          const redirectError = new TypeError("redirect disallowed");
          const base: typeof fetch = async (input, init) => {
            const request = new Request(input, init);
            sent.push(request);
            expect(await request.text()).toBe("public body");
            if (route.startsWith("retry-") && sent.length === 1) {
              expect(request.redirect).toBe("manual");
              expect(request.headers.get("Authorization")).toBe("DPoP sdk-token");
              return new Response(null, { status: 401 });
            }
            expect(request.redirect).toBe(redirect);
            for (const header of ["Authorization", "DPoP", "Proxy-Authorization"]) {
              expect(request.headers.has(header)).toBe(false);
            }
            // Model native redirect handling at the transport boundary.
            if (request.redirect === "error") throw redirectError;
            return result;
          };
          const url = `${POD}/${route === "issuer-bypass" ? ".well-known/openid-configuration" : "start"}`;
          const init = { method: "POST", body: "public body", redirect };
          const pending = asRequest
            ? proactiveAuthenticatedFetch(state, base, new Request(url, init))
            : proactiveAuthenticatedFetch(state, base, url, init);
          if (redirect === "error") await expect(pending).rejects.toBe(redirectError);
          else expect(await pending).toBe(result);
          expect(sent).toHaveLength(route.startsWith("retry-") ? 2 : 1);
          expect(upgrades).toBe(
            route === "retry-reset" || route === "retry-unchanged"
              ? 2
              : route === "first-reset" || route === "first-unchanged" || route === "retry-gate"
                ? 1
                : 0,
          );
        });
      }
    }
  }
});

describe("controller redirect nonce scoping", () => {
  it("retries and caches a second-origin nonce only for that checked hop", async () => {
    const sent: Request[] = [];
    const wrapped = await controllerFetch(
      async (input, init) => {
        const request = new Request(input, init);
        sent.push(request);
        if (sent.length === 1) {
          return new Response(null, { status: 302, headers: { Location: `${SECOND}/final` } });
        }
        if (sent.length === 2) {
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
              "DPoP-Nonce": "second-nonce",
            },
          });
        }
        return new Response("done");
      },
      [POD, SECOND],
    );
    expect((await wrapped(`${POD}/start`)).status).toBe(200);
    await wrapped(`${POD}/other`);
    await wrapped(`${SECOND}/other`);
    const proofs = await Promise.all(sent.map((request) => proofOf(request.headers.get("DPoP"))));
    expect(proofs.map((proof) => proof.nonce)).toEqual([
      undefined,
      undefined,
      "second-nonce",
      undefined,
      "second-nonce",
    ]);
    expect(proofs[2]).toMatchObject({ htu: `${SECOND}/final`, htm: "GET" });
    expect(proofs[2].jti).not.toBe(proofs[1].jti);
  });

  it("refuses a native-followed foreign response's nonce for the pod origin", async () => {
    const sent: Request[] = [];
    const wrapped = await controllerFetch(
      async (input, init) => {
        sent.push(new Request(input, init));
        const response = new Response("transport followed unexpectedly", {
          headers: { "DPoP-Nonce": "foreign-nonce" },
        });
        Object.defineProperty(response, "url", { value: `${FOREIGN}/final` });
        return response;
      },
      [POD],
    );
    await wrapped(`${POD}/start`);
    await wrapped(`${POD}/other`);
    expect((await proofOf(sent[1].headers.get("DPoP"))).nonce).toBeUndefined();
  });

  it("continues the loop when the nonce retry itself redirects", async () => {
    const sent: Request[] = [];
    const wrapped = await controllerFetch(
      async (input, init) => {
        sent.push(new Request(input, init));
        if (sent.length === 1) {
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
              "DPoP-Nonce": "pod-nonce",
            },
          });
        }
        return sent.length === 2
          ? new Response(null, { status: 302, headers: { Location: `${SECOND}/final` } })
          : new Response("done", { headers: { "DPoP-Nonce": "second-nonce" } });
      },
      [POD, SECOND],
    );
    expect((await wrapped(`${POD}/start`)).status).toBe(200);
    await wrapped(`${POD}/other`);
    await wrapped(`${SECOND}/other`);
    const proofs = await Promise.all(sent.map((request) => proofOf(request.headers.get("DPoP"))));
    expect(proofs.map((proof) => proof.nonce)).toEqual([
      undefined,
      "pod-nonce",
      undefined,
      "pod-nonce",
      "second-nonce",
    ]);
  });

  it("applies the credentialed redirect policy to the patched global fetch", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    try {
      await controllerFetch(
        async (input, init) => {
          const request = new Request(input, init);
          expect(request.redirect).toBe("manual");
          calls++;
          return new Response(null, { status: 302, headers: { Location: `${FOREIGN}/end` } });
        },
        [POD],
        true,
      );
      expect((await globalThis.fetch(`${POD}/start`, { redirect: "follow" })).status).toBe(302);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("credentialed redirects over loopback HTTP", () => {
  const received: {
    path?: string;
    method?: string;
    body: string;
    auth?: string;
    proof?: string;
  }[] = [];
  const foreignReceived: { auth?: string; proof?: string }[] = [];
  let destination = "/final";
  let status = 307;
  let origin: string;
  let second: string;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({
      path: request.url,
      method: request.method,
      body: Buffer.concat(chunks).toString(),
      auth: request.headers.authorization,
      proof: request.headers.dpop as string | undefined,
    });
    response.writeHead(request.url === "/start" ? status : 200, { Location: destination });
    response.end("ok");
  });
  const foreign = createServer((request, response) => {
    foreignReceived.push({
      auth: request.headers.authorization,
      proof: request.headers.dpop as string | undefined,
    });
    response.writeHead(200, { "DPoP-Nonce": "foreign-nonce" });
    response.end("foreign");
  });
  beforeAll(async () => {
    const start = async (instance: typeof server) => {
      instance.listen(0, "127.0.0.1");
      await once(instance, "listening");
      const address = instance.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP address");
      return `http://127.0.0.1:${address.port}`;
    };
    origin = await start(server);
    second = await start(foreign);
  });
  afterAll(async () => {
    for (const instance of [server, foreign]) {
      instance.closeAllConnections();
      if (instance.listening) {
        await new Promise<void>((resolve, reject) =>
          instance.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  for (const kind of ["controller", "proactive"] as const) {
    it(`${kind}: same-origin 307 POST replays bytes with a fresh proof`, async () => {
      received.length = 0;
      status = 307;
      destination = "/final";
      const wrapped = await wrappedFetch(kind, fetch, [origin]);
      const response = await wrapped(`${origin}/start`, { method: "POST", body: "ABC" });
      const clone = response.clone();
      const nestedClone = clone.clone();
      for (const result of [response, clone, nestedClone]) {
        expect(result.status).toBe(200);
        expect(result.redirected).toBe(true);
        expect(result.url).toBe(`${origin}/final`);
        expect(await result.text()).toBe("ok");
      }
      expect(
        received.map(({ path, method, body, auth }) => ({ path, method, body, auth })),
      ).toEqual(
        ["/start", "/final"].map((path) => ({
          path,
          method: "POST",
          body: "ABC",
          auth: `DPoP ${TOKEN}`,
        })),
      );
      const proofs = await Promise.all(received.map(({ proof }) => proofOf(proof)));
      expect(proofs[0]).toMatchObject({ htu: `${origin}/start`, htm: "POST" });
      expect(proofs[1]).toMatchObject({ htu: `${origin}/final`, htm: "POST" });
      expect(proofs[1].jti).not.toBe(proofs[0].jti);
    });

    it(`${kind}: foreign 302 is not followed and cannot leak headers or poison the pod nonce`, async () => {
      foreignReceived.length = 0;
      received.length = 0;
      status = 302;
      destination = `${second}/final`;
      const wrapped = await wrappedFetch(kind, fetch, [origin]);
      const response = await wrapped(`${origin}/start`, { redirect: "follow" });
      expect(response.status).toBe(302);
      expect(response.redirected).toBe(false);
      expect(response.url).toBe(`${origin}/start`);
      expect(response.headers.get("Location")).toBe(destination);
      expect(await response.text()).toBe("ok");
      expect(foreignReceived).toEqual([]);
      // Prove the destination is live, and that explicit public fetch stays public.
      await wrapped(destination);
      expect(foreignReceived).toEqual([{ auth: undefined, proof: undefined }]);
      await wrapped(`${origin}/other`);
      expect((await proofOf(received[1].proof)).nonce).toBeUndefined();
    });

    it(`${kind}: an allowlisted second origin receives a newly bound proof`, async () => {
      received.length = 0;
      foreignReceived.length = 0;
      status = 302;
      destination = `${second}/final`;
      const wrapped = await wrappedFetch(kind, fetch, [origin, second]);
      const response = await wrapped(`${origin}/start`);
      const clone = response.clone();
      for (const result of [response, clone]) {
        expect(result.status).toBe(200);
        expect(result.redirected).toBe(true);
        expect(result.url).toBe(destination);
        expect(await result.text()).toBe("foreign");
      }
      expect(foreignReceived).toHaveLength(1);
      expect(foreignReceived[0].auth).toBe(`DPoP ${TOKEN}`);
      const firstProof = await proofOf(received[0].proof);
      const nextProof = await proofOf(foreignReceived[0].proof);
      expect(nextProof).toMatchObject({ htu: destination, htm: "GET" });
      expect(nextProof.jti).not.toBe(firstProof.jti);
    });

    for (const asRequest of [false, true]) {
      it(`${kind}: caller-owned passthrough credentials never reach a redirected destination (${asRequest ? "Request" : "init"})`, async () => {
        received.length = 0;
        foreignReceived.length = 0;
        status = 302;
        destination = `${second}/final`;
        const wrapped = await wrappedFetch(kind, fetch, []);
        const init = {
          headers: { Authorization: "Bearer caller-token", DPoP: "caller-proof" },
          redirect: "follow" as const,
        };
        const response = asRequest
          ? await wrapped(new Request(`${origin}/start`, init))
          : await wrapped(`${origin}/start`, init);
        expect(response.status).toBe(302);
        expect(response.redirected).toBe(false);
        expect(response.url).toBe(`${origin}/start`);
        expect(await response.text()).toBe("ok");
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ auth: "Bearer caller-token", proof: "caller-proof" });
        expect(foreignReceived).toEqual([]);
        // Check the destination is live, so refusal is not a network false positive.
        expect((await fetch(destination)).status).toBe(200);
        expect(foreignReceived).toEqual([{ auth: undefined, proof: undefined }]);
      });
    }
  }
});
