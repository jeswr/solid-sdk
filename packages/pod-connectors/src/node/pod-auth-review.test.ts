// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import * as nodeAuth from "@jeswr/pod-auth/node";
import { serialize } from "@jeswr/rdf-serialize";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { Agent } from "@solid/object";
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoragePodWriter } from "../core/storage-pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import { writeResource } from "../pod/resource.js";
import { ProfileTypeIndexAnchor } from "../pod/type-index.js";
import type { NodeConfig } from "./config.js";
import { createClientCredentialsFetch } from "./pod-auth.js";

const tokenUrl = "https://issuer.test/token";
const otherPod = "https://second.test/alice/";
const indexA = `${TEST_POD_ROOT}settings/a.ttl`;
const indexB = `${TEST_POD_ROOT}settings/b.ttl`;
const config: NodeConfig = {
  podRoot: TEST_POD_ROOT,
  webId: TEST_WEBID,
  profileDocumentUrl: TEST_PROFILE_DOC,
  oidcIssuer: "https://issuer.test/",
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  connectors: {},
};
const token = () =>
  Response.json({ access_token: "synthetic-pod-token", token_type: "DPoP", expires_in: 300 });
afterEach(() => vi.restoreAllMocks());

/** A real pod-auth agent over the existing offline Pod transport. */
function fixture(intercept?: (url: string, init: RequestInit) => Promise<Response | undefined>) {
  const pod = createMemoryPod();
  let tokenCalls = 0;
  const transport = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = String(input);
    expect(init.redirect).toBe("manual");
    if (url === tokenUrl) tokenCalls++;
    const intercepted = await intercept?.(url, init);
    if (intercepted) return intercepted;
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({ issuer: config.oidcIssuer, token_endpoint: tokenUrl });
    if (url === tokenUrl) return token();
    expect(new Headers(init.headers).get("authorization")).toBe("DPoP synthetic-pod-token");
    return pod.fetch(input, {
      ...init,
      body:
        init.body instanceof Uint8Array &&
        new Headers(init.headers).get("content-type") === "text/turtle"
          ? new TextDecoder().decode(init.body)
          : init.body,
    });
  });
  async function profile(index: string) {
    const dataset = pod.dataset(TEST_PROFILE_DOC);
    new Agent(TEST_WEBID, dataset, DataFactory).storageUrls.add(otherPod);
    new ProfileTypeIndexAnchor(TEST_WEBID, dataset, DataFactory).privateIndex = index;
    await writeResource(TEST_PROFILE_DOC, dataset, { fetchImpl: pod.fetch });
    await pod.fetch(index, { method: "PUT", body: "", headers: { "content-type": "text/turtle" } });
    return serialize([...dataset], { format: "text/turtle" });
  }
  return { pod, transport, profile, tokenCalls: () => tokenCalls };
}

describe("Node Pod auth review regressions", () => {
  it("cancels one initialization waiter without cancelling the shared agent or other callers", async () => {
    const initialization = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    let sharedSignal: AbortSignal | null | undefined;
    const test = fixture(async (url, init) => {
      if (url === tokenUrl && test.tokenCalls() === 2) {
        sharedSignal = init.signal;
        started.resolve();
        return initialization.promise;
      }
    });
    await test.profile(indexA);
    const authenticated = await createClientCredentialsFetch(
      { ...config, podRoot: otherPod },
      test.transport,
    );
    await authenticated(TEST_PROFILE_DOC);
    const first = new AbortController();
    const reason = new Error("first caller cancelled");
    const rejected = expect(authenticated(indexA, { signal: first.signal })).rejects.toBe(reason);
    await started.promise;
    const second = authenticated(indexA, { signal: new AbortController().signal });
    first.abort(reason);
    await rejected;
    expect(sharedSignal?.aborted).toBe(false);
    initialization.resolve(token());
    expect((await second).ok).toBe(true);
    expect((await authenticated(indexA)).ok).toBe(true);
    expect(test.tokenCalls()).toBe(2);
  });

  it("keeps concurrent index requests independent after the agent has initialized", async () => {
    const started = Promise.withResolvers<void>();
    const responses = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
    const signals: AbortSignal[] = [];
    const test = fixture(async (url, init) => {
      if (url !== indexA || !new Headers(init.headers).has("x-caller")) return;
      const slot = Number(new Headers(init.headers).get("x-caller"));
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 2) started.resolve();
      signal.addEventListener("abort", () => responses[slot]?.reject(signal.reason), {
        once: true,
      });
      return responses[slot]?.promise;
    });
    await test.profile(indexA);
    const authenticated = await createClientCredentialsFetch(
      { ...config, podRoot: otherPod },
      test.transport,
    );
    await authenticated(TEST_PROFILE_DOC);
    await authenticated(indexA);
    const first = new AbortController();
    const reason = new Error("first resource cancelled");
    const rejected = expect(
      authenticated(indexA, { signal: first.signal, headers: { "x-caller": "0" } }),
    ).rejects.toBe(reason);
    const second = authenticated(indexA, { headers: { "x-caller": "1" } });
    await started.promise;
    first.abort(reason);
    await rejected;
    expect(signals.filter((signal) => signal.aborted)).toHaveLength(1);
    responses[1]?.resolve(new Response("second caller"));
    expect(await (await second).text()).toBe("second caller");
    expect((await authenticated(indexA)).ok).toBe(true);
    expect(test.tokenCalls()).toBe(2);
  });

  it("retries a rejected shared initialization without rereading the profile", async () => {
    const test = fixture(async (url) => {
      if (url === tokenUrl && test.tokenCalls() === 2)
        return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    });
    await test.profile(indexA);
    const authenticated = await createClientCredentialsFetch(
      { ...config, podRoot: otherPod },
      test.transport,
    );
    await authenticated(TEST_PROFILE_DOC);
    await expect(authenticated(indexA)).rejects.toThrow();
    expect((await authenticated(indexA)).ok).toBe(true);
    expect(test.tokenCalls()).toBe(3);
    expect(
      test.transport.mock.calls.filter(([url]) => String(url) === TEST_PROFILE_DOC),
    ).toHaveLength(1);
  });

  it("does not evict a newer index agent when an old initialization rejects", async () => {
    const oldInitialization = Promise.withResolvers<nodeAuth.PodAuth>();
    const started = Promise.withResolvers<void>();
    const original = nodeAuth.forClientCredentials;
    let factories = 0;
    vi.spyOn(nodeAuth, "forClientCredentials").mockImplementation((options) => {
      if (++factories === 2) {
        started.resolve();
        return oldInitialization.promise;
      }
      return original(options);
    });
    const test = fixture();
    await test.profile(indexA);
    const authenticated = await createClientCredentialsFetch(
      { ...config, podRoot: otherPod },
      test.transport,
    );
    await authenticated(TEST_PROFILE_DOC);
    const rejected = expect(authenticated(indexA)).rejects.toThrow("old initialization failed");
    await started.promise;
    await test.profile(indexB);
    await authenticated(TEST_PROFILE_DOC);
    const replacement = authenticated(indexB);
    oldInitialization.reject(new Error("old initialization failed"));
    await rejected;
    expect((await replacement).ok).toBe(true);
    expect((await authenticated(indexB)).ok).toBe(true);
    expect(factories).toBe(3);
    expect(test.tokenCalls()).toBe(2);
  });

  it("keeps the newer profile's index grant when an earlier profile returns last", async () => {
    const oldProfile = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    let reads = 0;
    const test = fixture(async (url) => {
      if (url === TEST_PROFILE_DOC && ++reads === 1) {
        started.resolve();
        return oldProfile.promise;
      }
    });
    const stale = await test.profile(indexA);
    const authenticated = await createClientCredentialsFetch(
      { ...config, podRoot: otherPod },
      test.transport,
    );
    const first = authenticated(TEST_PROFILE_DOC);
    await started.promise;
    await test.profile(indexB);
    await authenticated(TEST_PROFILE_DOC);
    expect((await authenticated(indexB)).ok).toBe(true);
    oldProfile.resolve(new Response(stale, { headers: { "content-type": "text/turtle" } }));
    await first;
    await expect(authenticated(indexA)).rejects.toThrow();
    expect((await authenticated(indexB)).ok).toBe(true);
    expect(test.transport.mock.calls.some(([url]) => String(url) === indexA)).toBe(false);
    expect(test.tokenCalls()).toBe(2);
  });

  it.each([
    "create",
    "update",
  ])("replays serialized RDF above 16 MiB with %s preconditions", async (mode) => {
    const requests: { digest: string; match: string | null; noneMatch: string | null }[] = [];
    const test = fixture(async (url, init) => {
      if (
        init.method === "PUT" &&
        init.body instanceof Uint8Array &&
        init.body.byteLength > 16 * 1024 * 1024
      ) {
        const headers = new Headers(init.headers);
        requests.push({
          digest: createHash("sha256").update(init.body).digest("hex"),
          match: headers.get("if-match"),
          noneMatch: headers.get("if-none-match"),
        });
        if (requests.length === 1)
          return new Response(null, { status: 401, headers: { "dpop-nonce": "rdf-nonce" } });
        expect(url).toBe(`${TEST_POD_ROOT}integrations/toy/large.ttl`);
      }
    });
    const authenticated = await createClientCredentialsFetch(config, test.transport);
    const storage = createSolidBackend({ root: TEST_POD_ROOT, fetch: authenticated });
    const writer = createStoragePodWriter({
      storage,
      container: `${TEST_POD_ROOT}integrations/toy/`,
    });
    const doc = {
      slug: "large.ttl",
      category: "media",
      forClass: "urn:Thing",
      dataset: new Store(),
    };
    if (mode === "update") await writer.write(doc, { ifNoneMatch: "*" });
    const etag = mode === "update" ? ((await writer.read(doc.slug))?.etag as string) : null;
    const value = "x".repeat(16 * 1024 * 1024 + 1);
    doc.dataset.addQuad(
      DataFactory.quad(
        DataFactory.namedNode("urn:item"),
        DataFactory.namedNode("urn:value"),
        DataFactory.literal(value),
      ),
    );
    await writer.write(doc, etag ? { ifMatch: etag } : { ifNoneMatch: "*" });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.digest).toBe(requests[1]?.digest);
    expect(requests.map(({ match, noneMatch }) => [match, noneMatch])).toEqual([
      [etag, etag ? null : "*"],
      [etag, etag ? null : "*"],
    ]);
    const stored = [...test.pod.dataset(writer.resolve(doc.slug))];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.object.value.length).toBe(value.length);
    expect(
      createHash("sha256")
        .update(stored[0]?.object.value ?? "")
        .digest("hex"),
    ).toBe(createHash("sha256").update(value).digest("hex"));
  });

  it.each([
    "application/json",
    "invalid",
    "",
  ])("keeps the ordinary replay cap for non-RDF strings (%s)", async (contentType) => {
    const test = fixture();
    const authenticated = await createClientCredentialsFetch(config, test.transport);
    await expect(
      authenticated(`${TEST_POD_ROOT}large.json`, {
        method: "PUT",
        body: " ".repeat(16 * 1024 * 1024 + 1),
        headers: { "content-type": contentType },
      }),
    ).rejects.toThrow();
    expect(
      test.transport.mock.calls.some(([url]) => String(url) === `${TEST_POD_ROOT}large.json`),
    ).toBe(false);
  });

  it.each([
    "discovery",
    "token",
  ])("rejects oversized declared %s JSON before reading, even when cancellation stalls or rejects", async (stage) => {
    for (const cancellation of ["stalls", "rejects", "absent"] as const) {
      const cancel = vi.fn(() =>
        cancellation === "rejects"
          ? Promise.reject(new Error("cancel failed"))
          : new Promise<void>(() => {}),
      );
      const pull = vi.fn();
      const response = new Response(
        cancellation === "absent"
          ? null
          : new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
        { headers: { "content-length": String(1024 * 1024 + 1) } },
      );
      const transport = vi.fn<typeof fetch>(async () => response);
      await expect(
        createClientCredentialsFetch(
          { ...config, ...(stage === "token" ? { tokenUrl } : {}) },
          transport,
        ),
      ).rejects.toMatchObject({ kind: "auth", message: "Pod client-credentials login failed." });
      expect(transport).toHaveBeenCalledOnce();
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(cancellation === "absent" ? 0 : 1);
    }
  });

  it.each(["discovery", "token"])("refuses an absent %s JSON body", async (stage) => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null));
    await expect(
      createClientCredentialsFetch(
        { ...config, ...(stage === "token" ? { tokenUrl } : {}) },
        transport,
      ),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects streamed protocol overflow even when body cancellation fails", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new Uint8Array(1024 * 1024 + 1));
            },
            cancel,
          }),
        ),
    );
    await expect(
      createClientCredentialsFetch({ ...config, tokenUrl }, transport),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a failed discovery body even when cancellation rejects", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), { status: 503 }),
    );
    await expect(createClientCredentialsFetch(config, transport)).rejects.toMatchObject({
      kind: "auth",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("handles cancellation between protocol headers and body acquisition", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled before token body acquisition");
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const test = fixture(async (url) => {
      if (url === tokenUrl && test.tokenCalls() === 2) {
        const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
        const response = new Response(body);
        Object.defineProperty(response, "body", {
          get() {
            controller.abort(reason);
            return body;
          },
        });
        return response;
      }
    });
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const authenticated = await createClientCredentialsFetch(config, test.transport);
    now += 301_000;
    await expect(
      authenticated(`${TEST_POD_ROOT}missing`, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it("cancels a stalled token JSON body with only the refreshing caller's signal", async () => {
    const reading = Promise.withResolvers<void>();
    const cancel = vi.fn();
    const test = fixture(async (url) => {
      if (url === tokenUrl && test.tokenCalls() === 2)
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                reading.resolve();
                return new Promise<void>(() => {});
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
        );
    });
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const authenticated = await createClientCredentialsFetch(config, test.transport);
    now += 301_000;
    const controller = new AbortController();
    const reason = new Error("refresh cancelled");
    const rejected = expect(
      authenticated(`${TEST_POD_ROOT}missing`, { signal: controller.signal }),
    ).rejects.toBe(reason);
    await reading.promise;
    controller.abort(reason);
    await rejected;
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect((await authenticated(`${TEST_POD_ROOT}missing`)).status).toBe(404);
    expect(test.tokenCalls()).toBe(3);
  });
});
