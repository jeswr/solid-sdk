// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { Parser } from "n3";
import { afterEach, test, vi } from "vitest";
import { FencedCache } from "../src/FencedCache.js";
import { contextKey, withLock } from "../src/locks.js";
import {
  CredentialBoundary,
  PatternIssuerProvider,
  ReactiveFetchManager,
  SessionFence,
} from "../src/mod.js";
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
  await fence.supersede();
  assert.deepEqual(channels[0].value, { type: "superseded", generation: 1 });
  fence.close();
  assert.equal(channels[0].closed, true);
  vi.stubGlobal("BroadcastChannel", undefined);
  const local = new SessionFence("no-channel");
  await local.supersede();
  assert.equal(await local.generation(), 1);
  local.close();
});

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
