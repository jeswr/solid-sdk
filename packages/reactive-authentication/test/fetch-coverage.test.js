// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { CredentialBoundary, ReactiveAuthenticationClient } from "../src/mod.js";

afterEach(() => vi.unstubAllGlobals());
const boundary = new CredentialBoundary(["https://pod.example/"]);
const provider = {
  matches: async () => true,
  upgrade: async (request) =>
    new Request(request, { headers: { authorization: "Bearer credential" } }),
};

test("the client exposes its boundary and defaults to the current pristine transport", async () => {
  vi.stubGlobal("fetch", async () => new Response("default"));
  const client = new ReactiveAuthenticationClient({ boundary, providers: [] });
  assert.equal(client.boundary, boundary);
  assert.equal(await (await client.fetch("https://pod.example/a")).text(), "default");
});

test("natively redirected 401s never replay writes and enforce the safe-method hop limit", async () => {
  const response = new Response(null, { status: 401 });
  Object.defineProperties(response, {
    redirected: { value: true },
    url: { value: "https://pod.example/target" },
  });
  const client = new ReactiveAuthenticationClient({
    boundary,
    providers: [provider],
    fetch: async () => response,
    maxRedirects: 0,
  });
  assert.equal(
    await client.fetch("https://pod.example/a", { method: "PUT", body: "write" }),
    response,
  );
  await assert.rejects(client.fetch("https://pod.example/a"), /Too many redirects/);
});

test("credentialed redirects reject missing targets and enforce hop limits", async () => {
  for (const [maxRedirects, headers, pattern] of [
    [0, { location: "/target" }, /Too many redirects/],
    [20, {}, /without Location/],
  ]) {
    const client = new ReactiveAuthenticationClient({
      boundary,
      providers: [provider],
      maxRedirects,
      fetch: async (request) =>
        request.headers.has("authorization")
          ? new Response(null, { status: 302, headers })
          : new Response(null, { status: 401 }),
    });
    await assert.rejects(client.fetch("https://pod.example/a"), pattern);
  }
});

test("same-URL redirects retain DPoP headers and 302 rewrites POSTs while dropping body headers", async () => {
  for (const method of ["POST", "GET"]) {
    const seen = [];
    const transport = async (request) => {
      seen.push(request);
      if (seen.length === 1) return new Response(null, { status: 401 });
      if (seen.length === 2)
        return new Response(null, { status: 302, headers: { location: "https://pod.example/a" } });
      return new Response("done");
    };
    const client = new ReactiveAuthenticationClient({
      boundary,
      providers: [{ ...provider, upgrade: async (request) => request }],
      fetch: transport,
    });
    assert.equal(
      await (
        await client.fetch("https://pod.example/a", {
          method,
          ...(method === "POST" ? { body: "body" } : {}),
          headers: { dpop: "caller-proof", "content-type": "text/plain" },
        })
      ).text(),
      "done",
    );
    assert.equal(seen[2].method, "GET");
    assert.equal(seen[2].headers.get("dpop"), "caller-proof");
    assert.equal(seen[2].headers.has("content-type"), method !== "POST");
  }
});

test("candidate requests without discovery and redirects that leave candidate scope stay anonymous", async () => {
  const client = new ReactiveAuthenticationClient({
    providers: [provider],
    boundary: { allows: () => false, isCandidate: () => true },
    fetch: async () => new Response(null, { status: 401 }),
  });
  assert.equal((await client.fetch("https://pod.example/a")).status, 401);
  const redirected = new Response(null, { status: 401 });
  Object.defineProperties(redirected, {
    redirected: { value: true },
    url: { value: "https://foreign.example/" },
  });
  const foreign = new ReactiveAuthenticationClient({
    providers: [provider],
    boundary: {
      allows: () => false,
      isCandidate: (url) => new URL(url).origin === "https://pod.example",
      discover: vi.fn(),
    },
    fetch: async () => redirected,
  });
  assert.equal(await foreign.fetch("https://pod.example/a"), redirected);
});

test("navigation requests are replayed with same-origin mode", async () => {
  const Original = Request;
  class NavigationRequest extends Original {
    get mode() {
      return super.mode === "cors" ? "navigate" : super.mode;
    }
  }
  vi.stubGlobal("Request", NavigationRequest);
  const fetch = vi.fn(async () => new Response("ok"));
  const client = new ReactiveAuthenticationClient({ boundary, providers: [], fetch });
  assert.equal((await client.fetch("https://pod.example/a")).status, 200);
  assert.equal(fetch.mock.calls[0][0].mode, "same-origin");
});

test("runtimes without request streams replay blobs, reject oversized bodies, and propagate read errors", async () => {
  const Original = Request;
  class WithoutStreams extends Original {
    get body() {
      return undefined;
    }
  }
  vi.stubGlobal("Request", WithoutStreams);
  const seen = [];
  const client = new ReactiveAuthenticationClient({
    boundary,
    providers: [provider],
    maxReplayBodyBytes: 4,
    fetch: async (request) => {
      seen.push(await request.text());
      return new Response(null, { status: seen.length === 1 ? 401 : 200 });
    },
  });
  assert.equal(
    (await client.fetch("https://pod.example/a", { method: "POST", body: "body" })).status,
    200,
  );
  assert.deepEqual(seen, ["body", "body"]);
  assert.equal((await client.fetch("https://pod.example/a")).status, 200);
  assert.equal((await client.fetch("https://pod.example/a", { method: "HEAD" })).status, 200);
  assert.equal((await client.fetch("https://pod.example/a", { method: "POST" })).status, 200);
  await assert.rejects(
    client.fetch("https://pod.example/a", { method: "PUT", body: "longer" }),
    /exceeds 4/,
  );
  class BrokenBlob extends WithoutStreams {
    async blob() {
      throw new Error("read failed");
    }
  }
  vi.stubGlobal("Request", BrokenBlob);
  await assert.rejects(
    client.fetch("https://pod.example/a", { method: "POST", body: "x" }),
    /read failed/,
  );
  const gate = Promise.withResolvers();
  const readingStarted = Promise.withResolvers();
  class SlowBlob extends WithoutStreams {
    blob() {
      readingStarted.resolve();
      return gate.promise;
    }
  }
  vi.stubGlobal("Request", SlowBlob);
  const controller = new AbortController();
  const pending = client.fetch("https://pod.example/a", {
    method: "POST",
    body: "x",
    signal: controller.signal,
  });
  const rejected = assert.rejects(pending, /cancelled/);
  await readingStarted.promise;
  controller.abort(new Error("cancelled"));
  gate.reject(new Error("late read failure"));
  await rejected;
});

test("stream cancellation and already-consumed challenge bodies do not hide the authentication result", async () => {
  const response = new Response("already consumed", { status: 401 });
  await response.text();
  let calls = 0;
  const client = new ReactiveAuthenticationClient({
    boundary,
    providers: [provider],
    fetch: async () => (++calls === 1 ? response : new Response("ok")),
  });
  assert.equal(await (await client.fetch("https://pod.example/a")).text(), "ok");
  const cancellation = new Error("cancelled");
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const stream = new ReadableStream({
    pull() {
      started();
    },
    cancel() {
      return Promise.reject(new Error("cancel failed"));
    },
  });
  const controller = new AbortController();
  const pending = client.fetch("https://pod.example/a", {
    method: "POST",
    body: stream,
    duplex: "half",
    signal: controller.signal,
  });
  const rejected = assert.rejects(pending, (error) => error === cancellation);
  await ready;
  controller.abort(cancellation);
  await rejected;
});

test("abort without a reason fails closed and failed discard/cancel operations stay secondary", async () => {
  const controller = new AbortController();
  const client = new ReactiveAuthenticationClient({
    boundary,
    providers: [provider],
    fetch: async () => {
      controller.abort(null);
      return new Response(null, { status: 401 });
    },
  });
  await assert.rejects(client.fetch("https://pod.example/a", { signal: controller.signal }), {
    name: "AbortError",
  });
  let calls = 0;
  const body = new ReadableStream({
    cancel() {
      throw new Error("discard failed");
    },
  });
  const discard = new ReactiveAuthenticationClient({
    boundary,
    providers: [provider],
    fetch: async () => (++calls === 1 ? new Response(body, { status: 401 }) : new Response("ok")),
  });
  assert.equal(await (await discard.fetch("https://pod.example/a")).text(), "ok");
  const oversized = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(2));
    },
    cancel() {
      throw new Error("cancel failed");
    },
  });
  const limited = new ReactiveAuthenticationClient({
    boundary,
    providers: [],
    maxReplayBodyBytes: 1,
    fetch: async () => new Response(),
  });
  await assert.rejects(
    limited.fetch("https://pod.example/a", { method: "POST", body: oversized, duplex: "half" }),
    /exceeds 1/,
  );
});
