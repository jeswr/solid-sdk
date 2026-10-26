// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { Parser } from "n3";
import { afterEach, test, vi } from "vitest";
import { FencedCache } from "../src/FencedCache.js";
import { contextKey, withLock } from "../src/locks.js";
import {
  CredentialBoundary,
  OAuthBearerTokenProvider,
  PatternIssuerProvider,
  ReactiveFetchManager,
  SessionFence,
} from "../src/mod.js";
import { OidcSession } from "../src/OidcSession.js";
import { SimpleDataset } from "../src/SimpleDataset.js";
import {
  clientAuthFor,
  expectedNonce,
  isEssMissingIssInteractionNeeded,
} from "../src/serverQuirks.js";

afterEach(() => vi.unstubAllGlobals());

test("dataset mutation and term matching preserve set membership", () => {
  const [a, b] = new Parser().parse(
    "<https://a> <https://p> <https://o> . <https://b> <https://p> <https://o> .",
  );
  const dataset = new SimpleDataset([a]);
  assert.equal(dataset.size, 1);
  assert.equal(dataset.add(a), dataset);
  assert.equal(dataset.size, 1);
  dataset.add(b);
  assert.equal(dataset.size, 2);
  assert.deepEqual([...dataset.match(a.subject, a.predicate, a.object, a.graph)], [a]);
  assert.equal(dataset.match(null, b.subject).size, 0);
  assert.equal(dataset.match(null, null, b.subject).size, 0);
  assert.equal(dataset.match(null, null, null, b.subject).size, 0);
  assert.deepEqual([...dataset.match()], [a, b]);
  assert.equal(dataset.delete(a), dataset);
  dataset.delete(a);
  assert.equal(dataset.has(a), false);
  assert.equal(dataset.has(b), true);
});

test("pattern issuers reject unmatched requests and static boundaries validate all entries", async () => {
  const provider = new PatternIssuerProvider([
    { pattern: /^https:\/\/pod.example\//, result: "https://issuer.example/" },
  ]);
  assert.equal(
    (await provider.getIssuer(new Request("https://pod.example/a"))).href,
    "https://issuer.example/",
  );
  await assert.rejects(provider.getIssuer(new Request("https://other.example/a")), {
    name: "UnrecognizedRequestUri",
  });
  for (const entry of [
    "relative",
    "ftp://pod.example/",
    "https://user@pod.example/",
    "https://pod.example/?x=1",
    "https://pod.example/#me",
  ]) {
    assert.throws(() => new CredentialBoundary([entry]), TypeError);
  }
  const boundary = new CredentialBoundary(["https://pod.example/a"]);
  assert.equal(boundary.allows("http://pod.example/a"), false);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const unrestricted = CredentialBoundary.unrestricted();
  assert.equal(unrestricted.allows("https://other.example/"), true);
  assert.equal(unrestricted.allows("http://other.example/"), true);
  assert.equal(warn.mock.calls.length, 1);
});

test("global manager registration is idempotent and preserves a later wrapper", async () => {
  const original = vi.fn(async () => new Response("original"));
  vi.stubGlobal("fetch", original);
  const manager = new ReactiveFetchManager({ providers: [], boundary: new CredentialBoundary() });
  assert.equal(await (await manager.fetch("https://foreign.example/")).text(), "original");
  assert.equal(manager.client.providers.length, 0);
  assert.equal(typeof manager.transport, "function");
  manager.unregisterGlobally();
  manager.registerGlobally();
  manager.registerGlobally();
  assert.equal(globalThis.fetch, manager.fetch);
  manager.unregisterGlobally();
  assert.equal(globalThis.fetch, original);
  manager.registerGlobally();
  const later = async () => new Response("later");
  globalThis.fetch = later;
  manager.unregisterGlobally();
  assert.equal(globalThis.fetch, later);
  const error = new Error("clear failed");
  const failed = new ReactiveFetchManager({
    providers: [
      {
        forget: async () => {
          throw error;
        },
      },
      {},
    ],
    boundary: new CredentialBoundary(),
    fetch: original,
  });
  let logouts = 0;
  failed.addEventListener("logout", () => {
    logouts++;
  });
  await assert.rejects(
    failed.logout(),
    (e) => e instanceof AggregateError && e.errors[0] === error,
  );
  assert.equal(logouts, 1);
});

test("third-party providers retain cancellation at send without exposing a fence", async () => {
  const controller = new AbortController();
  const reason = new Error("provider cancelled");
  const sent = [];
  const provider = {
    matches: async () => true,
    upgrade: async (request) =>
      new Request(request, {
        headers: { authorization: "Bearer third-party" },
        signal: AbortSignal.any([request.signal, controller.signal]),
      }),
  };
  const manager = new ReactiveFetchManager({
    providers: [provider],
    boundary: new CredentialBoundary(["https://api.example/"]),
    fetch: async (request) => {
      sent.push(request);
      if (request.headers.has("authorization")) return new Response("sent");
      return new Response(new ReadableStream({ cancel: () => controller.abort(reason) }), {
        status: 401,
      });
    },
  });
  await assert.rejects(manager.fetch("https://api.example/private"), (error) => error === reason);
  assert.equal(sent.length, 1);
});

test("fenced caches clear non-clearable stores and reject stale values", async () => {
  const values = createMemoryStore();
  const store = { getItem: values.getItem, setItem: values.setItem, removeItem: values.removeItem };
  const fence = new SessionFence("non-clearable", { broadcast: false });
  const cache = new FencedCache("test", { namespace: "app", store, fence });
  assert.equal(fence.namespace, "non-clearable");
  const ticket = await cache.ticket(new AbortController().signal);
  const key = await cache.key(["entry"]);
  await cache.write(key, { token: "old" }, ticket);
  await cache.forget();
  assert.equal(await store.getItem(key), null);
  assert.equal(ticket.signal.aborted, true);
  fence.close();
  assert.throws(() => new SessionFence(""), /namespace/);
  vi.stubGlobal("navigator", undefined);
  await assert.rejects(
    withLock("no-locks", async () => 1),
    /Web Locks/,
  );
  assert.notEqual(await contextKey("k", [undefined]), await contextKey("k", ["-"]));
});

test("broadcast fences ignore unknown messages and invalidate peer work on supersession", async () => {
  const channels = [];
  class Channel {
    constructor() {
      channels.push(this);
    }
    postMessage(value) {
      this.value = value;
    }
    close() {
      this.closed = true;
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const fence = new SessionFence("broadcast");
  const signal = fence.signal;
  channels[0].onmessage({ data: null });
  channels[0].onmessage({ data: { type: "unknown" } });
  assert.equal(signal.aborted, false);
  channels[0].onmessage({ data: { type: "superseded", generation: 1 } });
  assert.equal(signal.aborted, true);
  assert.equal(fence.signal.aborted, false);
  assert.equal(await fence.generation(), 1, "memory-only peers retain the notified generation");
  await fence.supersede();
  assert.deepEqual(channels[0].value, { type: "superseded", generation: 2 });
  fence.close();
  assert.equal(channels[0].closed, true);
  vi.stubGlobal("BroadcastChannel", undefined);
  const local = new SessionFence("no-channel");
  await local.supersede();
  assert.equal(await local.generation(), 1);
  local.close();
});

test("fence signals follow observed generations and ignore delayed, duplicate and older broadcasts", async () => {
  const channels = [];
  class Channel {
    constructor() {
      channels.push(this);
    }
    postMessage(value) {
      this.value = value;
    }
    close() {}
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const store = createMemoryStore();
  const fence = new SessionFence("delayed-broadcast", { store });
  const peer = new SessionFence("delayed-broadcast", { store });
  const cache = new FencedCache("test", { fence });
  try {
    const old = await cache.ticket(new AbortController().signal);
    await peer.supersede();
    assert.equal(old.signal.aborted, false, "the peer notification is still queued");
    const fresh = await cache.ticket(new AbortController().signal);
    assert.equal(fresh.generation, 1);
    assert.equal(old.signal.aborted, true, "observing generation 1 cancels generation 0");
    assert.equal(fresh.signal.aborted, false);
    channels[0].onmessage({ data: channels[1].value });
    channels[0].onmessage({ data: { type: "superseded", generation: 0 } });
    assert.equal(fresh.signal.aborted, false);
    const key = await cache.key(["fresh"]);
    await cache.write(key, { token: "fresh" }, fresh);
    assert.deepEqual(await cache.read(key, fresh), { token: "fresh" });

    await peer.supersede();
    channels[0].onmessage({ data: channels[1].value });
    assert.equal(fresh.signal.aborted, true, "a newer logout still cancels old work");
    const newest = await cache.ticket(new AbortController().signal);
    assert.equal(newest.generation, 2);
    channels[0].onmessage({ data: channels[1].value });
    channels[0].onmessage({ data: { type: "superseded", generation: 1 } });
    assert.equal(newest.signal.aborted, false);
    await fence.supersede();
    assert.equal(newest.signal.aborted, true, "local logout cancels its current generation");
  } finally {
    fence.close();
    peer.close();
  }
});

for (const notification of ["broadcast", "durable read"]) {
  test(`assertCurrent rejects a generation superseded by ${notification} during its store read`, async () => {
    let channel;
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          channel = this;
        }
        close() {}
      },
    );
    const values = createMemoryStore();
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    let paused = true;
    const fence = new SessionFence(crypto.randomUUID(), {
      store: {
        ...values,
        getItem: async (key) => {
          const value = await values.getItem(key);
          if (paused) {
            started.resolve();
            await gate.promise;
          }
          return value;
        },
      },
    });
    try {
      const rejected = assert.rejects(fence.assertCurrent(0), { name: "SessionSupersededError" });
      await started.promise;
      paused = false;
      if (notification === "broadcast") {
        channel.onmessage({ data: { type: "superseded", generation: 1 } });
      } else {
        await values.setItem("generation", 1);
        assert.equal(await fence.generation(), 1);
      }
      gate.resolve();
      await rejected;
    } finally {
      gate.resolve();
      fence.close();
    }
  });

  test(`a generation read pending across ${notification} keeps its superseded signal`, async () => {
    let channel;
    class Channel {
      constructor() {
        channel = this;
      }
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    const store = createMemoryStore();
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    let paused = true;
    const fence = new SessionFence("pending-generation", {
      store: {
        ...store,
        getItem: async (key) => {
          const value = await store.getItem(key);
          if (paused) {
            started.resolve();
            await gate.promise;
          }
          return value;
        },
      },
    });
    const peer = new SessionFence("pending-generation", { store, broadcast: false });
    const cache = new FencedCache("test", { fence });
    try {
      const pending = cache.ticket(new AbortController().signal);
      await started.promise;
      await peer.supersede();
      paused = false;
      if (notification === "broadcast") {
        channel.onmessage({ data: { type: "superseded", generation: 1 } });
      } else {
        assert.equal(await fence.generation(), 1);
      }
      gate.resolve();
      const stale = await pending;
      assert.equal(stale.generation, 0, "the original read never adopts the new generation");
      assert.equal(stale.signal.aborted, true);
      await assert.rejects(cache.write(await cache.key(["stale"]), { token: "old" }, stale), {
        name: "SessionSupersededError",
      });
    } finally {
      gate.resolve();
      fence.close();
      peer.close();
    }
  });
}

for (const operation of [
  "cache validation",
  "session validation",
  "session acquisition",
  "Bearer upgrade",
]) {
  test(`${operation} rechecks caller cancellation after asynchronous fence validation`, async () => {
    const values = createMemoryStore();
    const started = Promise.withResolvers();
    const gate = Promise.withResolvers();
    let reads = 0;
    const fence = new SessionFence(crypto.randomUUID(), {
      broadcast: false,
      store: {
        ...values,
        getItem: async (key) => {
          if (
            ++reads ===
            (operation === "Bearer upgrade" || operation === "session acquisition" ? 2 : 1)
          ) {
            started.resolve();
            await gate.promise;
          }
          return await values.getItem(key);
        },
      },
    });
    const controller = new AbortController();
    const reason = new Error("cancelled during validation");
    try {
      let pending;
      let credentialRead;
      if (operation === "cache validation") {
        pending = new FencedCache("test", { fence }).assertCurrent({
          generation: 0,
          signal: controller.signal,
        });
      } else if (operation === "session validation") {
        pending = new OidcSession("https://app.example/cb", {}, {}, { fence }).assertCurrent(
          { generation: 0 },
          controller.signal,
        );
      } else if (operation === "session acquisition") {
        credentialRead = vi.fn(async () => ({ generation: 0 }));
        const session = new OidcSession(
          "https://app.example/cb",
          {},
          {},
          {
            namespace: "test",
            fence,
            cache: { getItem: credentialRead },
          },
        );
        pending = session.get(
          { issuer: "https://issuer.example" },
          "test",
          controller.signal,
          () => true,
        );
      } else {
        const provider = new OAuthBearerTokenProvider(
          { id: "api", getAccessToken: async () => ({ token: "access" }) },
          { resources: ["https://api.example/"], fence },
        );
        pending = provider.upgrade(
          new Request("https://api.example/private", { signal: controller.signal }),
        );
      }
      const rejected = assert.rejects(pending, (error) => error === reason);
      await started.promise;
      controller.abort(reason);
      gate.resolve();
      await rejected;
      if (credentialRead !== undefined)
        assert.equal(credentialRead.mock.calls.length, 0, "no credential read after cancellation");
    } finally {
      gate.resolve();
      fence.close();
    }
  });
}

test("server exceptions reject malformed inputs and client-secret-post stays protocol compliant", async () => {
  assert.equal(isEssMissingIssInteractionNeeded(null, "https://login.inrupt.com"), false);
  assert.equal(isEssMissingIssInteractionNeeded({}, "invalid"), false);
  assert.equal(isEssMissingIssInteractionNeeded({}, "https://other.example"), false);
  assert.equal(
    isEssMissingIssInteractionNeeded(
      { cause: { parameters: new URLSearchParams("error=interaction_required") } },
      "https://login.inrupt.com",
    ),
    true,
  );
  assert.equal(expectedNonce("invalid", "nonce"), "nonce");
  const body = new URLSearchParams();
  const headers = new Headers();
  await clientAuthFor("https://issuer.example", {
    client_id: "c",
    client_secret: "s",
    token_endpoint_auth_method: "client_secret_post",
  })({}, { client_id: "c" }, body, headers);
  assert.equal(body.get("client_id"), "c");
  assert.equal(body.get("client_secret"), "s");
  assert.equal(headers.has("authorization"), false);
  const basic = new Headers();
  await clientAuthFor("https://issuer.example", { client_id: "c", client_secret: "s" })(
    {},
    { client_id: "c" },
    new URLSearchParams(),
    basic,
  );
  assert.equal(basic.get("authorization"), `Basic ${btoa("c:s")}`);
});
