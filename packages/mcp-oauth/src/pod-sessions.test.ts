// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DEFAULT_MAX_REPLAY_BODY_BYTES } from "@jeswr/solid-openid-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, RESOURCE } from "../test/fixtures.js";
import {
  POD_CALLBACK,
  POD_CLIENT,
  POD_ISSUER,
  POD_ROOT,
  POD_WEBID,
  podIssuer,
} from "../test/pod-issuer.js";
import { createPodSessionProvider } from "./pod-sessions.js";
import { digest, GRANT_TTL, LOGIN_TTL, MAX_BYTES } from "./protocol.js";
import { createSessionVault } from "./vault.js";
import { MemoryVaultStore } from "./vault-stores.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function brokerFixture() {
  const op = podIssuer();
  const store = new MemoryVaultStore();
  const vault = createSessionVault({ key: Buffer.alloc(32, 9).toString("base64"), store });
  let now = Math.floor(Date.now() / 1000);
  const options = {
    clientId: POD_CLIENT,
    redirectUri: POD_CALLBACK,
    vault,
    fetch: op.fetch,
    now: () => now,
  };
  const provider = createPodSessionProvider(options);
  const login = async (input = POD_ISSUER) => {
    const begin = await provider.begin(input, POD_CALLBACK);
    const callback = op.callback(begin.authorizeUrl);
    const session = await provider.complete(callback, begin.state);
    return { begin, callback, session };
  };
  return {
    op,
    store,
    vault,
    provider,
    options,
    login,
    advance(seconds: number) {
      now += seconds;
    },
  };
}

describe("Solid-OIDC pod broker", () => {
  it("binds PKCE + nonce + DPoP, returns identity only, scopes fetch and retries nonces once", async () => {
    const f = brokerFixture();
    f.op.controls.tokenNonce = true;
    const { session } = await f.login(POD_WEBID);
    expect(Object.keys(session).sort()).toEqual(["id", "webId"]);
    expect(session.webId).toBe(POD_WEBID);
    const fetcher = await f.provider.fetchFor(session.id);
    f.op.controls.resourceNonce = true;
    expect(
      await (await fetcher(`${POD_ROOT}notes`, { method: "PUT", body: "fixture body" })).json(),
    ).toEqual({ ok: true, nonce: "fixture-resource-nonce" });
    const resources = f.op.captured.filter((r) => r.url.startsWith(POD_ROOT));
    expect(resources.map((r) => r.body)).toEqual(["fixture body", "fixture body"]);
    f.op.controls.alwaysResourceNonce = true;
    const count = f.op.captured.length;
    expect(
      (await fetcher(new Request(`${POD_ROOT}notes`, { method: "POST", body: "stream body" })))
        .status,
    ).toBe(401);
    expect(f.op.captured.length - count).toBe(2);
    f.op.controls.alwaysResourceNonce = false;
    await fetcher(new URL(`${POD_ROOT}notes`));
    for (const target of [
      "https://foreign.example/",
      `${POD_ROOT}../bob/secret`,
      "https://pod.example/alice-evil/",
      `${POD_ROOT}%2e%2e/secret`,
    ])
      await expect(fetcher(target)).rejects.toThrow("scope");
    for (const header of ["authorization", "dpop", "cookie"]) {
      await expect(
        fetcher(`${POD_ROOT}notes`, { headers: { [header]: "fixture-mcp-token" } }),
      ).rejects.toThrow("Caller credentials");
      await expect(
        fetcher(new Request(`${POD_ROOT}notes`, { headers: { [header]: "fixture" } })),
      ).rejects.toThrow("Caller credentials");
    }
    const other = await f.login();
    expect(other.session.id).not.toBe(session.id);
    const authRequests = f.op.captured.filter(
      (r) => r.url.endsWith("/token") && r.body.includes("authorization_code"),
    );
    const jwks = authRequests.map(
      (r) =>
        JSON.parse(
          Buffer.from(
            (r.headers.get("dpop") as string).split(".")[0] as string,
            "base64url",
          ).toString(),
        ).jwk.x,
    );
    expect(new Set(jwks).size).toBe(2);
  });

  it.each([
    "request",
    "init",
  ])("rejects and cancels oversized %s bodies before transport", async (input) => {
    const f = brokerFixture();
    const { session } = await f.login();
    const fetcher = await f.provider.fetchFor(session.id);
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(DEFAULT_MAX_REPLAY_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        // Keep the source open: rejection must cancel it without an unread tee branch.
      },
      cancel,
    });
    const target = `${POD_ROOT}notes`;
    const init = { method: "PUT", body, duplex: "half" };
    const running =
      input === "request" ? fetcher(new Request(target, init)) : fetcher(target, init);
    await expect(running).rejects.toThrow("replay buffer cap");
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(expect.any(Error));
    expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT))).toHaveLength(0);
  });

  it.each([
    { input: "request", timing: "before" },
    { input: "request", timing: "during" },
    { input: "init", timing: "before" },
    { input: "init", timing: "during" },
  ])("cancels $input bodies when aborted $timing buffering", async ({ input, timing }) => {
    const f = brokerFixture();
    const { session } = await f.login();
    const fetcher = await f.provider.fetchFor(session.id);
    const controller = new AbortController();
    const reason = new Error(`Fixture abort ${timing} buffering`);
    const cancel = vi.fn();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        pull(source) {
          source.enqueue(new TextEncoder().encode("partial body"));
          started();
          // Stay open with the next read pending until the caller aborts.
          return new Promise<void>(() => {});
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const target = `${POD_ROOT}notes`;
    const init = { method: "PUT", body, signal: controller.signal, duplex: "half" };
    if (timing === "before") controller.abort(reason);
    const running =
      input === "request" ? fetcher(new Request(target, init)) : fetcher(target, init);
    const rejected = expect(running).rejects.toBe(reason);
    if (timing === "during") {
      await reading;
      controller.abort(reason);
    }
    await rejected;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT))).toHaveLength(0);
  });

  it.each([
    ["text/turtle", "# Pod resource with a discovery pathname"],
    ["application/json", JSON.stringify({ title: "Pod resource" })],
    ["application/json", JSON.stringify({ issuer: "https://unrelated.example/" })],
  ])("returns %s pod resources with a discovery pathname unchanged", async (contentType, body) => {
    const f = brokerFixture();
    const target = `${POD_ROOT}.well-known/openid-configuration`;
    const requests: Request[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url === target) {
        requests.push(request);
        return new Response(body, { headers: { "content-type": contentType } });
      }
      return f.op.fetch(request);
    };
    const options = { ...f.options, fetch: fetcher };
    const provider = createPodSessionProvider(options);
    const begin = await provider.begin(POD_ISSUER, POD_CALLBACK);
    const session = await provider.complete(f.op.callback(begin.authorizeUrl), begin.state);
    for (const broker of [provider, createPodSessionProvider(options)]) {
      const response = await (await broker.fetchFor(session.id))(target);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(await response.text()).toBe(body);
    }
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get("authorization")).toMatch(/^DPoP /u);
      expect(request.headers.has("dpop")).toBe(true);
    }
    expect(f.op.captured.filter((r) => r.body.includes("grant_type=refresh_token"))).toHaveLength(
      1,
    );
  });

  it("restores refresh + the same key across workers and persists rotations before fetching", async () => {
    const f = brokerFixture();
    const { session } = await f.login();
    const before = await f.vault.get(`session:${session.id}`);
    const restarted = createPodSessionProvider(f.options);
    const fetcher = await restarted.fetchFor(session.id);
    f.op.controls.tokenNonce = true;
    await fetcher(`${POD_ROOT}notes`);
    const after = await f.vault.get(`session:${session.id}`);
    expect(after).not.toEqual(before);
    const record = JSON.parse(Buffer.from(after as Uint8Array).toString());
    expect(record.refreshToken).toBe("fixture-pod-refresh-2");
    expect(record.key).toEqual(JSON.parse(Buffer.from(before as Uint8Array).toString()).key);
    f.advance(601);
    f.op.controls.rotateRefresh = false;
    await fetcher(`${POD_ROOT}notes`);
    const persisted = JSON.parse(
      Buffer.from((await f.vault.get(`session:${session.id}`)) as Uint8Array).toString(),
    );
    expect(persisted.refreshToken).toBe(record.refreshToken);
    expect(
      f.op.captured.filter(
        (r) => r.url.endsWith("/token") && r.body.includes("grant_type=refresh_token"),
      ),
    ).toHaveLength(3); // nonce retry plus next refresh
    expect(await f.store.get(`session:${session.id}`)).not.toContain("fixture-pod-refresh");
  });

  it.each([
    "matching nonce",
    "omitted nonce",
    "omitted ID token",
  ])("preserves original OIDC claims through restored refreshes with %s", async (variant) => {
    const f = brokerFixture();
    f.op.controls.idSubject = "fixture-original-subject";
    const { begin, session } = await f.login();
    const nonce = new URL(begin.authorizeUrl).searchParams.get("nonce");
    const key = `session:${session.id}`;
    const original = JSON.parse(Buffer.from((await f.vault.get(key)) as Uint8Array).toString());
    expect(original).toMatchObject({ subject: "fixture-original-subject", nonce });
    if (variant === "matching nonce") f.op.controls.refreshNonce = nonce as string;
    if (variant === "omitted ID token") f.op.controls.refreshIdToken = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const restarted = createPodSessionProvider(f.options);
      expect((await (await restarted.fetchFor(session.id))(`${POD_ROOT}notes`)).status).toBe(200);
      const updated = JSON.parse(Buffer.from((await f.vault.get(key)) as Uint8Array).toString());
      expect(updated).toMatchObject({
        subject: original.subject,
        nonce: original.nonce,
        refreshToken: `fixture-pod-refresh-${attempt + 2}`,
      });
      // Even an intervening response without a nonce must retain the original binding.
      f.op.controls.refreshNonce = nonce as string;
      f.op.controls.refreshIdToken = true;
    }
    expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT))).toHaveLength(2);
  });

  it.each([
    "subject",
    "nonce",
  ])("retires a restored session before accepting refreshed credentials with a changed %s", async (claim) => {
    const f = brokerFixture();
    const { session } = await f.login();
    const restarted = createPodSessionProvider(f.options);
    const fetcher = await restarted.fetchFor(session.id);
    if (claim === "subject") f.op.controls.idSubject = "other-subject-with-the-same-webid";
    else f.op.controls.refreshNonce = "different-login-nonce";
    const swap = vi.spyOn(f.vault, "compareAndSwap");
    await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow(`Refreshed ${claim} mismatch`);
    expect(swap).toHaveBeenCalledTimes(1); // Claim ownership, without persisting new credentials.
    expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT))).toHaveLength(0);
    expect(await f.vault.get(`session:${session.id}`)).toBeUndefined();
    expect(await f.provider.isActive(session.id)).toBe(false);
    await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow("inactive");
  });

  it("rejects callback substitution, duplicate params, wrong state and callback reuse", async () => {
    const f = brokerFixture();
    const begin = await f.provider.begin(POD_ISSUER, POD_CALLBACK);
    const callback = f.op.callback(begin.authorizeUrl);
    await expect(
      f.provider.complete(callback.replace("mcp.example", "evil.example"), begin.state),
    ).rejects.toThrow("callback");
    await expect(f.provider.complete(`${callback}#fragment`, begin.state)).rejects.toThrow(
      "callback",
    );
    await expect(f.provider.complete(`${callback}&state=duplicate`, begin.state)).rejects.toThrow();
    await expect(f.provider.complete(callback, "wrong")).rejects.toThrow("state");
    const unknown = new URL(callback);
    unknown.searchParams.set("state", "unknown");
    await expect(f.provider.complete(unknown.href, "unknown")).rejects.toThrow("Unknown");
    await f.provider.complete(callback, begin.state);
    await expect(f.provider.complete(callback, begin.state)).rejects.toThrow("Unknown");
    expect(f.op.captured.filter((r) => r.url.endsWith("/token"))).toHaveLength(1);
  });

  it("consumes callbacks before expiry and issuer/nonce/error validation", async () => {
    const f = brokerFixture();
    const begin = await f.provider.begin(POD_ISSUER, POD_CALLBACK);
    f.advance(LOGIN_TTL);
    await expect(
      f.provider.complete(f.op.callback(begin.authorizeUrl), begin.state),
    ).rejects.toThrow("Expired");
    for (const change of ["issuer", "nonce", "denied", "idIssuer"]) {
      const g = brokerFixture();
      const next = await g.provider.begin(POD_ISSUER, POD_CALLBACK);
      const url = new URL(g.op.callback(next.authorizeUrl));
      if (change === "issuer") url.searchParams.set("iss", "https://rogue.example/");
      if (change === "nonce") g.op.controls.idNonce = "wrong-nonce";
      if (change === "denied") {
        url.searchParams.delete("code");
        url.searchParams.set("error", "access_denied");
      }
      if (change === "idIssuer") g.op.controls.idIssuer = "https://rogue.example/";
      await expect(g.provider.complete(url.href, next.state)).rejects.toThrow();
      await expect(g.provider.complete(url.href, next.state)).rejects.toThrow("Unknown");
    }
  });

  it("fails closed on issuer mismatch, malformed discovery and unsafe URLs", async () => {
    const f = brokerFixture();
    await expect(f.provider.begin(POD_ISSUER, "https://other.example/callback")).rejects.toThrow(
      "callback",
    );
    for (const input of [
      "invalid",
      "http://issuer.example/",
      "https://u:p@issuer.example/",
      "https://issuer.example/ bad",
    ])
      await expect(f.provider.begin(input, POD_CALLBACK)).rejects.toThrow();
    f.op.controls.discoveryIssuer = "https://rogue.example/";
    await expect(f.provider.begin(POD_ISSUER, POD_CALLBACK)).rejects.toThrow("issuer");
    expect(f.op.captured.every((r) => !r.url.includes("/profile"))).toBe(true);
    f.op.controls.discoveryIssuer = POD_ISSUER;
    f.op.controls.discoveryStatus = 503;
    await expect(f.provider.begin(POD_ISSUER, POD_CALLBACK)).rejects.toThrow("discovery");
    f.op.controls.discoveryStatus = 200;
    f.op.controls.discoveryType = "text/html";
    await expect(f.provider.begin(POD_ISSUER, POD_CALLBACK)).rejects.toThrow("discovery");
    for (const count of [0, 2]) {
      f.op.controls.profileIssuers = count;
      await expect(f.provider.begin(POD_WEBID, POD_CALLBACK)).rejects.toThrow("exactly one");
    }
    expect(() =>
      createPodSessionProvider({ ...f.options, redirectUri: `${POD_CALLBACK}?q=1` }),
    ).toThrow("query");
    expect(() =>
      createPodSessionProvider({ ...f.options, clientId: "http://mcp.example/client" }),
    ).toThrow();
    expect(
      createPodSessionProvider({ ...f.options, fetch: undefined, now: undefined }),
    ).toBeDefined();
  });

  it("validates the authenticated WebID against the requested identity and profile issuer", async () => {
    for (const variant of ["identity", "profile", "refresh", "type"]) {
      const f = brokerFixture();
      const begin = await f.provider.begin(POD_WEBID, POD_CALLBACK);
      if (variant === "identity") f.op.controls.webId = "https://other.example/profile#me";
      if (variant === "profile") f.op.controls.profileIssuer = "https://rogue.example/";
      if (variant === "refresh") f.op.controls.issueRefresh = false;
      if (variant === "type") f.op.controls.tokenType = "Bearer";
      await expect(
        f.provider.complete(f.op.callback(begin.authorizeUrl), begin.state),
      ).rejects.toThrow();
    }
  });

  it("checks discovery equality again on the engine's discovery request", async () => {
    const f = brokerFixture();
    let discoveryCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/.well-known/openid-configuration") && ++discoveryCount === 2)
        f.op.controls.discoveryIssuer = "https://rogue.example/";
      return f.op.fetch(input, init);
    };
    const provider = createPodSessionProvider({ ...f.options, fetch: fetcher });
    await expect(provider.begin(POD_ISSUER, POD_CALLBACK)).rejects.toMatchObject({
      cause: { message: "Pod issuer mismatch" },
    });
    const defaultClock = createPodSessionProvider({ ...f.options, now: undefined });
    f.op.controls.discoveryIssuer = POD_ISSUER;
    await defaultClock.begin(POD_ISSUER, POD_CALLBACK);
  });

  it.each([
    "begin",
    "complete",
    "restore",
  ])("rejects and cancels oversized streaming engine discovery during %s", async (phase) => {
    const f = brokerFixture();
    let discoveryCount = 0;
    let response: Response | undefined;
    const cancel = vi.fn();
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (
        request.url.endsWith("/.well-known/openid-configuration") &&
        (phase !== "begin" || ++discoveryCount === 2)
      ) {
        response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_BYTES));
              controller.enqueue(new Uint8Array(1));
              // Leave the stream open so rejection must cancel the source.
            },
            cancel,
          }),
          { headers: { "content-type": "application/json" } },
        );
        return response;
      }
      return f.op.fetch(request);
    };
    const provider = createPodSessionProvider({ ...f.options, fetch: fetcher });
    const operation = async () => {
      if (phase === "begin") return provider.begin(POD_ISSUER, POD_CALLBACK);
      if (phase === "complete") {
        const begin = await f.provider.begin(POD_ISSUER, POD_CALLBACK);
        return provider.complete(f.op.callback(begin.authorizeUrl), begin.state);
      }
      const { session } = await f.login();
      return (await provider.fetchFor(session.id))(`${POD_ROOT}notes`);
    };
    await expect(operation()).rejects.toMatchObject({
      cause: { error: "invalid_request", status: 413 },
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response?.bodyUsed).toBe(true);
    expect(response?.body?.locked).toBe(false);
  });

  it("passes streamed discovery at the size limit to the engine", async () => {
    const f = brokerFixture();
    let discoveryCount = 0;
    let response: Response | undefined;
    const cancel = vi.fn();
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const original = await f.op.fetch(request);
      if (request.url.endsWith("/.well-known/openid-configuration") && ++discoveryCount === 2) {
        const body = Buffer.from((await original.text()).padEnd(MAX_BYTES));
        response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(body.subarray(0, 100));
              controller.enqueue(body.subarray(100));
              controller.close();
            },
            cancel,
          }),
          original,
        );
        return response;
      }
      return original;
    };
    const provider = createPodSessionProvider({ ...f.options, fetch: fetcher });
    const begin = await provider.begin(POD_ISSUER, POD_CALLBACK);
    expect(new URL(begin.authorizeUrl).origin).toBe(new URL(POD_ISSUER).origin);
    expect(response?.bodyUsed).toBe(true);
    expect(response?.body?.locked).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("atomically consumes pending state and fails closed on record collisions", async () => {
    const f = brokerFixture();
    const cas = vi.spyOn(f.vault, "compareAndSwap");
    cas.mockResolvedValueOnce(false);
    await expect(f.provider.begin(POD_ISSUER, POD_CALLBACK)).rejects.toThrow("collision");
    const begin = await f.provider.begin(POD_ISSUER, POD_CALLBACK);
    const callback = f.op.callback(begin.authorizeUrl);
    cas.mockResolvedValueOnce(false);
    await expect(f.provider.complete(callback, begin.state)).rejects.toThrow("consumed");
    cas.mockRestore();
    const next = await f.provider.begin(POD_ISSUER, POD_CALLBACK);
    const originalCas = f.vault.compareAndSwap.bind(f.vault);
    vi.spyOn(f.vault, "compareAndSwap").mockImplementation((id, expected, secret) =>
      id.startsWith("session:") ? Promise.resolve(false) : originalCas(id, expected, secret),
    );
    await expect(f.provider.complete(f.op.callback(next.authorizeUrl), next.state)).rejects.toThrow(
      "collision",
    );
    vi.restoreAllMocks();
    const used = await f.provider.begin(POD_ISSUER, POD_CALLBACK);
    await f.vault.put(`login:${digest(used.state)}`, Buffer.from('{"kind":"used"}'));
    await expect(f.provider.complete(f.op.callback(used.authorizeUrl), used.state)).rejects.toThrow(
      "consumed",
    );
  });

  it("rejects retired/expired sessions and rechecks previously returned fetch functions", async () => {
    const f = brokerFixture();
    expect(await f.provider.isActive("missing")).toBe(false);
    await expect(f.provider.fetchFor("missing")).rejects.toThrow("inactive");
    const { session } = await f.login();
    const fetcher = await f.provider.fetchFor(session.id);
    await f.provider.revoke(session.id);
    expect(await f.provider.isActive(session.id)).toBe(false);
    await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow("inactive");
    await expect(f.provider.fetchFor(session.id)).rejects.toThrow("inactive");
    const next = await f.login();
    const expiredFetch = await f.provider.fetchFor(next.session.id);
    f.advance(GRANT_TTL);
    expect(await f.provider.isActive(next.session.id)).toBe(false);
    await expect(expiredFetch(`${POD_ROOT}notes`)).rejects.toThrow("inactive");
  });

  it("rejects cross-client and corrupt session records", async () => {
    const f = brokerFixture();
    const { session } = await f.login();
    const key = `session:${session.id}`;
    const value = JSON.parse(Buffer.from((await f.vault.get(key)) as Uint8Array).toString());
    for (const change of [
      { kind: "other" },
      { identity: { id: "other" } },
      { clientId: "other" },
      { redirect: "other" },
      { subject: undefined },
      { subject: "" },
      { nonce: undefined },
      { nonce: "" },
    ]) {
      await f.vault.put(key, Buffer.from(JSON.stringify({ ...value, ...change })));
      await expect(f.provider.isActive(session.id)).rejects.toThrow("Invalid pod session");
    }
  });

  it("claims refresh exclusively, prevents resurrection during revocation and retires failed refreshes", async () => {
    const f = brokerFixture();
    const { session } = await f.login();
    const restarted = createPodSessionProvider(f.options);
    const a = await restarted.fetchFor(session.id);
    const b = await createPodSessionProvider(f.options).fetchFor(session.id);
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const paused = new Promise<void>((r) => {
      release = r;
    });
    f.op.controls.onToken = async () => {
      entered();
      await paused;
    };
    const running = a(`${POD_ROOT}notes`);
    await started;
    await expect(b(`${POD_ROOT}notes`)).rejects.toThrow("claimed");
    await f.provider.revoke(session.id);
    release();
    await expect(running).rejects.toThrow("revoked");
    expect(await f.provider.isActive(session.id)).toBe(false);
    const g = brokerFixture();
    const live = await g.login();
    g.advance(601);
    g.op.controls.tokenError = true;
    await expect(
      (await g.provider.fetchFor(live.session.id))(`${POD_ROOT}notes`),
    ).rejects.toThrow();
    expect(await g.provider.isActive(live.session.id)).toBe(false);
  });

  it("rejects refresh identity changes, CAS races, and missing access lifetimes", async () => {
    for (const variant of ["identity", "claim", "lifetime"]) {
      const f = brokerFixture();
      if (variant === "lifetime") f.op.controls.expiresIn = undefined;
      const { session } = await f.login();
      f.advance(601);
      const fetcher = await f.provider.fetchFor(session.id);
      if (variant === "identity") f.op.controls.refreshWebId = "https://other.example/profile#me";
      if (variant === "claim") vi.spyOn(f.vault, "compareAndSwap").mockResolvedValueOnce(false);
      if (variant === "lifetime") await fetcher(`${POD_ROOT}notes`);
      else await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow();
      vi.restoreAllMocks();
    }
  });

  it("rechecks durable revocation after persisting rotated credentials", async () => {
    const f = brokerFixture();
    const { session } = await f.login();
    const fetcher = await f.provider.fetchFor(session.id);
    f.advance(601);
    const swap = f.vault.compareAndSwap.bind(f.vault);
    vi.spyOn(f.vault, "compareAndSwap").mockImplementation(async (id, expected, secret) => {
      const result = await swap(id, expected, secret);
      if (!JSON.parse(Buffer.from(secret).toString()).refreshing)
        await f.provider.revoke(session.id);
      return result;
    });
    await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow("inactive");
    expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT))).toHaveLength(0);
  });

  it("bounds private clients and restores an evicted session with its original key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = brokerFixture();
    const first = await f.login();
    let last = first;
    for (let index = 0; index < 256; index++) last = await f.login();
    expect(vi.getTimerCount()).toBe(256);
    const refreshes = () =>
      f.op.captured.filter((r) => r.url.endsWith("/token") && r.body.includes("refresh_token="));
    await (await f.provider.fetchFor(last.session.id))(`${POD_ROOT}notes`);
    expect(refreshes()).toHaveLength(0);
    await (await f.provider.fetchFor(first.session.id))(`${POD_ROOT}notes`);
    expect(refreshes()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(256);
  }, 20_000);

  it("evicts idle clients on a timer and when the injected clock advances", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const timer of [true, false]) {
      const f = brokerFixture();
      const { session } = await f.login();
      expect(vi.getTimerCount()).toBe(1);
      f.advance(300);
      if (timer) {
        await vi.advanceTimersByTimeAsync(300_000);
        expect(vi.getTimerCount()).toBe(0);
      }
      await (await f.provider.fetchFor(session.id))(`${POD_ROOT}notes`);
      expect(
        f.op.captured.filter((r) => r.url.endsWith("/token") && r.body.includes("refresh_token=")),
      ).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
      await f.provider.revoke(session.id);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("expires cached credentials at the earlier access or session deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const deadline of ["access", "session"]) {
      const f = brokerFixture();
      if (deadline === "access") f.op.controls.expiresIn = 30;
      const { session } = await f.login();
      if (deadline === "session") {
        const key = `session:${session.id}`;
        const value = JSON.parse(Buffer.from((await f.vault.get(key)) as Uint8Array).toString());
        await f.vault.put(
          key,
          Buffer.from(JSON.stringify({ ...value, expiresAt: f.options.now() + 30 })),
        );
        await (await f.provider.fetchFor(session.id))(`${POD_ROOT}notes`);
      }
      expect(vi.getTimerCount()).toBe(1);
      f.advance(30);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(vi.getTimerCount()).toBe(0);
      expect(await f.provider.isActive(session.id)).toBe(deadline === "access");
    }
  });

  it("drops cached credentials when another worker revokes, expiry is observed, or liveness fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const failure of ["revocation", "expiry", "corrupt", "outage"]) {
      const f = brokerFixture();
      const { session } = await f.login();
      const fetcher = await f.provider.fetchFor(session.id);
      expect(vi.getTimerCount()).toBe(1);
      if (failure === "revocation") await createPodSessionProvider(f.options).revoke(session.id);
      if (failure === "expiry") f.advance(GRANT_TTL);
      if (failure === "corrupt") await f.vault.put(`session:${session.id}`, Buffer.from("invalid"));
      if (failure === "outage") vi.spyOn(f.vault, "get").mockRejectedValue(new Error("offline"));
      await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      expect(f.op.captured.filter((r) => r.url.startsWith(POD_ROOT))).toHaveLength(0);
    }
  });

  it("drops stale clients before refresh contention and even when retirement storage fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const failure of ["claimed", "conflict", "retirement"]) {
      const f = brokerFixture();
      const { session } = await f.login();
      expect(vi.getTimerCount()).toBe(1);
      if (failure === "retirement") {
        vi.spyOn(f.vault, "delete").mockRejectedValueOnce(new Error("offline"));
        await expect(f.provider.revoke(session.id)).rejects.toThrow("offline");
      } else {
        const fetcher = await f.provider.fetchFor(session.id);
        const key = `session:${session.id}`;
        const value = JSON.parse(Buffer.from((await f.vault.get(key)) as Uint8Array).toString());
        await f.vault.put(
          key,
          Buffer.from(
            JSON.stringify({
              ...value,
              expiresAt: value.expiresAt - 1,
              refreshing: failure === "claimed",
            }),
          ),
        );
        if (failure === "conflict")
          vi.spyOn(f.vault, "compareAndSwap").mockResolvedValueOnce(false);
        await expect(fetcher(`${POD_ROOT}notes`)).rejects.toThrow(
          failure === "claimed" ? "claimed" : "conflict",
        );
      }
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});

describe("MCP grant to pod session boundary", () => {
  it("rejects session revocation during MCP token issuance", async () => {
    const f = fixture();
    const id = await f.register();
    const code = await f.code(id);
    f.provider.isActive = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await f.exchange(id, code)).status).toBe(400);
  });
  it("never serializes pod credentials, rejects MCP token passthrough and cascades in both directions", async () => {
    const f = brokerFixture();
    const oauth = fixture({ podSessions: f.provider });
    const id = await oauth.register();
    const authorization = await oauth.server.handle(oauth.authRequest(id, { webid: POD_WEBID }));
    const callback = f.op.callback(authorization.headers.get("location") as string);
    const response = await oauth.server.handle(new Request(callback));
    const location = response.headers.get("location") as string;
    const code = new URL(location).searchParams.get("code") as string;
    const exchange = await oauth.exchange(id, code);
    const text = await exchange.clone().text();
    const tokens = await exchange.json();
    const claims = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url").toString(),
    );
    for (const serialized of [
      JSON.stringify([...authorization.headers]),
      location,
      text,
      JSON.stringify(claims),
      JSON.stringify(await oauth.stores.grants.get(claims.sid)),
    ]) {
      expect(serialized).not.toContain("fixture-pod-");
      expect(serialized).not.toContain('"d"');
      expect(serialized).not.toContain('"key"');
    }
    const principal = await oauth.server.verifyAccessToken(tokens.access_token, RESOURCE);
    const podFetch = await f.provider.fetchFor(principal.sessionId);
    await expect(
      podFetch(`${POD_ROOT}notes`, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
    ).rejects.toThrow("Caller credentials");
    const secondCode = await oauth.server.authorize(oauth.authRequest(id), {
      id: principal.sessionId,
      webId: POD_WEBID,
    });
    const second = await (
      await oauth.exchange(
        id,
        new URL(secondCode.headers.get("location") as string).searchParams.get("code") as string,
      )
    ).json();
    await oauth.form("revoke", { client_id: id, token: tokens.refresh_token });
    await expect(oauth.server.verifyAccessToken(second.access_token, RESOURCE)).rejects.toThrow(
      "invalid_token",
    );
    expect((await oauth.refresh(id, second.refresh_token)).status).toBe(400);
    await expect(podFetch(`${POD_ROOT}notes`)).rejects.toThrow("inactive");
    const other = await f.login();
    const accepted = await oauth.server.authorize(oauth.authRequest(id), other.session);
    const next = await (
      await oauth.exchange(
        id,
        new URL(accepted.headers.get("location") as string).searchParams.get("code") as string,
      )
    ).json();
    await f.provider.revoke(other.session.id);
    expect((await oauth.refresh(id, next.refresh_token)).status).toBe(400);
    await expect(
      oauth.server.authorize(oauth.authRequest(id), other.session),
    ).resolves.toHaveProperty("status", 302);
    expect(
      f.op.captured.every((r) => !r.headers.get("authorization")?.includes(tokens.access_token)),
    ).toBe(true);
  });
  it("retires all sibling grants on MCP replay despite concurrent credential updates", async () => {
    for (const type of ["code", "refresh"]) {
      const f = brokerFixture();
      const { session } = await f.login();
      const oauth = fixture({ podSessions: f.provider });
      const id = await oauth.register();
      const response = await oauth.server.authorize(oauth.authRequest(id), session);
      const code = new URL(response.headers.get("location") as string).searchParams.get(
        "code",
      ) as string;
      const tokens = await (await oauth.exchange(id, code)).json();
      const siblingResponse = await oauth.server.authorize(oauth.authRequest(id), session);
      const siblingCode = new URL(
        siblingResponse.headers.get("location") as string,
      ).searchParams.get("code") as string;
      const sibling = await (await oauth.exchange(id, siblingCode)).json();
      const swap = f.store.compareAndSwap.bind(f.store);
      let conflicted = false;
      vi.spyOn(f.store, "compareAndSwap").mockImplementation(async (key, expected, value) => {
        if (key === `session:${session.id}` && value === "deleted" && !conflicted) {
          conflicted = true;
          const bytes = (await f.vault.get(key)) as Uint8Array;
          const record = JSON.parse(Buffer.from(bytes).toString());
          await f.vault.put(key, Buffer.from(JSON.stringify({ ...record, refreshing: true })));
        }
        return swap(key, expected, value);
      });
      if (type === "code") expect((await oauth.exchange(id, code)).status).toBe(400);
      else {
        expect((await oauth.refresh(id, tokens.refresh_token)).status).toBe(200);
        expect((await oauth.refresh(id, tokens.refresh_token)).status).toBe(400);
      }
      expect(conflicted).toBe(true);
      expect(await f.provider.isActive(session.id)).toBe(false);
      await expect(oauth.server.verifyAccessToken(tokens.access_token, RESOURCE)).rejects.toThrow();
      await expect(
        oauth.server.verifyAccessToken(sibling.access_token, RESOURCE),
      ).rejects.toThrow();
      expect((await oauth.refresh(id, sibling.refresh_token)).status).toBe(400);
    }
  });

  it.each([
    "revoke",
    "code",
    "refresh",
  ])("persists session revocation through cleanup failures on %s and retries after restart", async (trigger) => {
    const f = brokerFixture();
    const { session } = await f.login();
    const oauth = fixture({ podSessions: f.provider });
    const id = await oauth.register();
    const authorize = async (clientId: string) => {
      const response = await oauth.server.authorize(oauth.authRequest(clientId), session);
      return new URL(response.headers.get("location") as string).searchParams.get("code") as string;
    };
    const code = await authorize(id);
    const tokens = await (await oauth.exchange(id, code)).json();
    const siblingId = await oauth.register();
    const sibling = await (await oauth.exchange(siblingId, await authorize(siblingId))).json();
    const pendingCode = await authorize(siblingId);
    const other = await f.login();
    const otherResponse = await oauth.server.authorize(oauth.authRequest(id), other.session);
    const otherCode = new URL(otherResponse.headers.get("location") as string).searchParams.get(
      "code",
    ) as string;
    const unrelated = await (await oauth.exchange(id, otherCode)).json();
    if (trigger === "refresh")
      expect((await oauth.refresh(id, tokens.refresh_token)).status).toBe(200);

    const cleanup = vi.spyOn(f.vault, "delete").mockRejectedValue(new Error("vault unavailable"));
    const rejected =
      trigger === "revoke"
        ? await oauth.form("revoke", { client_id: id, token: tokens.refresh_token })
        : trigger === "code"
          ? await oauth.exchange(id, code)
          : await oauth.refresh(id, tokens.refresh_token);
    expect(rejected.status).toBe(500);
    expect(await rejected.json()).toEqual({ error: "server_error" });
    expect(await f.provider.isActive(session.id)).toBe(true);

    const restarted = fixture({
      stores: oauth.stores,
      signingKey: oauth.key,
      podSessions: createPodSessionProvider(f.options),
    });
    for (const token of [tokens.access_token, sibling.access_token]) {
      await expect(restarted.server.verifyAccessToken(token, RESOURCE)).rejects.toMatchObject({
        error: "invalid_token",
      });
    }
    expect((await restarted.refresh(siblingId, sibling.refresh_token)).status).toBe(400);
    expect((await restarted.exchange(siblingId, pendingCode)).status).toBe(400);
    const denied = await restarted.server.authorize(restarted.authRequest(id), session);
    expect(new URL(denied.headers.get("location") as string).searchParams.get("error")).toBe(
      "access_denied",
    );
    await expect(
      restarted.server.verifyAccessToken(unrelated.access_token, RESOURCE),
    ).resolves.toMatchObject({ sessionId: other.session.id });
    expect(cleanup.mock.calls.length).toBeGreaterThan(1);

    // Already-revoked grants still drive credential cleanup after the vault recovers.
    cleanup.mockRestore();
    const retry = vi.spyOn(f.vault, "delete");
    expect((await restarted.exchange(id, code)).status).toBe(400);
    expect(retry).toHaveBeenCalledWith(`session:${session.id}`);
    expect(await f.provider.isActive(session.id)).toBe(false);
  });

  it("snapshots caller inputs before the asynchronous liveness check", async () => {
    const f = brokerFixture();
    const { session } = await f.login();
    const fetcher = await f.provider.fetchFor(session.id);
    const get = f.vault.get.bind(f.vault);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.vault, "get").mockImplementationOnce(async (key) => {
      await gate;
      return get(key);
    });
    const url = new URL(`${POD_ROOT}notes`);
    const headers = new Headers({ "x-snapshot": "original" });
    const running = fetcher(url, { headers });
    url.href = "https://foreign.example/secret";
    headers.set("cookie", "fixture-caller-cookie");
    release();
    expect((await running).status).toBe(200);
    const resource = f.op.captured.at(-1);
    expect(resource?.url).toBe(`${POD_ROOT}notes`);
    expect(resource?.headers.has("cookie")).toBe(false);
  });

  it.each([
    "url",
    "headers",
    "request",
    "options",
  ])("sends the validated request snapshot despite caller %s mutation during refresh", async (variant) => {
    const f = brokerFixture();
    const { session } = await f.login();
    const fetcher = await createPodSessionProvider(f.options).fetchFor(session.id);
    const url = new URL(`${POD_ROOT}notes`);
    const headers = new Headers({ "x-snapshot": "original" });
    const request = new Request(url, { headers });
    const init: RequestInit = {
      headers,
      method: "PUT",
      body: "original",
      redirect: "follow",
      credentials: "include",
    };
    f.op.controls.onToken = async () => {
      if (variant === "url") url.href = "https://foreign.example/secret";
      if (variant === "headers") headers.set("cookie", "fixture-caller-cookie");
      if (variant === "request") request.headers.set("cookie", "fixture-caller-cookie");
      if (variant === "options") {
        init.headers = { cookie: "fixture-caller-cookie" };
        init.method = "DELETE";
        init.body = "changed";
      }
    };
    f.op.controls.resourceNonce = true;
    const result = await fetcher(variant === "request" ? request : url, init);
    expect(result.status).toBe(200);
    const resources = f.op.captured.filter((r) => r.url.startsWith(POD_ROOT));
    expect(resources).toHaveLength(2);
    for (const resource of resources) {
      expect(resource.url).toBe(`${POD_ROOT}notes`);
      expect(resource.method).toBe("PUT");
      expect(resource.body).toBe("original");
      expect(resource.headers.get("x-snapshot")).toBe("original");
      expect(resource.headers.has("cookie")).toBe(false);
    }
  });
});
