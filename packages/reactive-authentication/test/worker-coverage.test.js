// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { CredentialBoundary, ReactiveFetchWorkerManager } from "../src/mod.js";
import {
  BridgedCodeProvider,
  BridgedIssuerProvider,
  installReactiveAuthentication,
  WindowBridge,
} from "../src/service-worker.js";
import { isInteractionReply, REQUEST_TYPE } from "../src/worker/messages.js";

afterEach(() => vi.unstubAllGlobals());

function windowSide(options = {}) {
  const listeners = new Map();
  const registration = {};
  const serviceWorker = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    register: vi.fn(async () => registration),
    ready: Promise.resolve(),
  };
  class Worker {
    scriptURL = "https://app.example/sw.js";
  }
  vi.stubGlobal("ServiceWorker", Worker);
  vi.stubGlobal("location", { origin: "https://app.example" });
  vi.stubGlobal("navigator", { serviceWorker });
  const dispose = vi.fn();
  const manager = new ReactiveFetchWorkerManager({
    scriptUrl: new URL("https://app.example/sw.js"),
    codeProvider: {
      getCode: async () => ({
        value: "https://app.example/callback?code=c",
        [Symbol.dispose]: dispose,
      }),
    },
    ...options,
  });
  const port = { postMessage: vi.fn(), close: vi.fn() };
  const event = {
    ports: [port],
    origin: location.origin,
    source: new Worker(),
    data: { type: REQUEST_TYPE, kind: "code", url: "https://issuer.example/authorize" },
  };
  return { manager, serviceWorker, registration, listeners, port, event, dispose };
}

test("page bridge registers scoped modules, validates worker origin, and disposes authorization responses", async () => {
  const w = windowSide({ scope: "/app/" });
  assert.equal(await w.manager.register(), w.registration);
  assert.deepEqual(w.serviceWorker.register.mock.calls[0], [
    new URL("https://app.example/sw.js"),
    { type: "module", scope: "/app/" },
  ]);
  const handle = w.listeners.get("message");
  handle({ ...w.event, ports: [] });
  handle({ ...w.event, origin: "https://evil.example" });
  handle({ ...w.event, source: {} });
  handle({
    ...w.event,
    source: Object.assign(new ServiceWorker(), { scriptURL: "https://app.example/other.js" }),
  });
  handle({ ...w.event, data: {} });
  const Worker = ServiceWorker;
  vi.stubGlobal("ServiceWorker", undefined);
  handle(w.event);
  vi.stubGlobal("ServiceWorker", Worker);
  assert.equal(w.port.postMessage.mock.calls.length, 0);
  handle(w.event);
  await vi.waitFor(() => assert.equal(w.port.close.mock.calls.length, 1));
  assert.deepEqual(w.port.postMessage.mock.calls, [
    [{ ok: true, value: "https://app.example/callback?code=c" }],
  ]);
  assert.equal(w.dispose.mock.calls.length, 1);
  w.manager.unregisterListener();
  assert.equal(w.listeners.has("message"), false);
});

test("page bridge replies with bounded errors and routes issuer interactions", async () => {
  for (const [options, kind, expected] of [
    [{}, "issuer", { ok: false, name: "Error", message: "No issuer provider configured" }],
    [
      { issuerProvider: { getIssuer: async () => new URL("https://issuer.example/") } },
      "issuer",
      { ok: true, value: "https://issuer.example/" },
    ],
    [
      {
        codeProvider: {
          getCode: async () => {
            throw "denied";
          },
        },
      },
      "code",
      { ok: false, name: "Error", message: "denied" },
    ],
    [
      {
        codeProvider: { getCode: async () => ({ value: "x".repeat(8193), [Symbol.dispose]() {} }) },
      },
      "code",
      { ok: false, name: "Error", message: "Authorization response too long" },
    ],
  ]) {
    const w = windowSide(options);
    await w.manager.register();
    assert.deepEqual(w.serviceWorker.register.mock.calls[0][1], { type: "module" });
    w.listeners.get("message")({ ...w.event, data: { ...w.event.data, kind } });
    await vi.waitFor(() => assert.equal(w.port.close.mock.calls.length, 1));
    assert.deepEqual(w.port.postMessage.mock.calls, [[expected]]);
  }
});

test("worker cancellation aborts the page UI without replying on its cancelled port", async () => {
  let signal;
  const gate = Promise.withResolvers();
  const w = windowSide({
    codeProvider: {
      getCode: async (_url, s) => {
        signal = s;
        return gate.promise;
      },
    },
  });
  await w.manager.register();
  w.listeners.get("message")(w.event);
  w.port.onmessage({ data: null });
  w.port.onmessage({ data: { type: "other" } });
  assert.equal(signal.aborted, false);
  w.port.onmessage({ data: { type: "cancel" } });
  assert.equal(signal.aborted, true);
  gate.reject(signal.reason);
  await vi.waitFor(() => assert.equal(w.port.close.mock.calls.length, 1));
  assert.equal(w.port.postMessage.mock.calls.length, 0);
});

test("worker installer shares iterable providers and isolates factory providers by live window", async () => {
  const boundary = new CredentialBoundary(["https://pod.example/"]);
  const listeners = new Map();
  let alive = ["a", "b"];
  const scope = {
    fetch: vi.fn(async () => new Response("public")),
    clients: { matchAll: async () => alive.map((id) => ({ id })) },
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const shared = installReactiveAuthentication(scope, { boundary, providers: [] });
  assert.equal(shared("a"), shared("b"));
  const reply = vi.fn();
  listeners.get("fetch")({ request: new Request("https://foreign.example/"), respondWith: reply });
  assert.equal(reply.mock.calls.length, 0);
  listeners.get("fetch")({
    request: new Request("https://pod.example/private"),
    clientId: "a",
    respondWith: reply,
  });
  assert.equal(await (await reply.mock.calls[0][0]).text(), "public");
  const factory = vi.fn(() => []);
  const clientFor = installReactiveAuthentication(scope, {
    boundary,
    providers: factory,
    fetch: scope.fetch,
  });
  const a = clientFor("a");
  assert.equal(clientFor("a"), a);
  assert.notEqual(clientFor("b"), a);
  alive = ["b", "c"];
  clientFor("c");
  await vi.waitFor(() => assert.notEqual(clientFor("a"), a));
  assert.ok(factory.mock.calls.length >= 4);
});

test("issuer bridge returns URL responses, rejects malformed messages, and catches send failures", async () => {
  assert.equal(isInteractionReply(null), false);
  assert.equal(isInteractionReply("bad"), false);
  assert.equal(isInteractionReply({ ok: true, value: "not a url" }), false);
  const ports = [];
  const scope = {
    clients: {
      get: async () => undefined,
      matchAll: async () => [
        {
          visibilityState: "hidden",
          postMessage(_message, [port]) {
            ports.push(port);
            port.postMessage({ ok: true, value: "https://issuer.example/" });
          },
        },
      ],
    },
  };
  const bridge = new WindowBridge(scope);
  assert.equal(
    (await new BridgedIssuerProvider(bridge).getIssuer(new Request("https://pod.example/"))).href,
    "https://issuer.example/",
  );
  await assert.rejects(
    bridge
      .forClient("gone")
      .request("issuer", "https://pod.example/", new AbortController().signal),
    /gone/,
  );
  scope.clients.matchAll = async () => [
    {
      postMessage() {
        throw new Error("unavailable");
      },
    },
  ];
  await assert.rejects(
    bridge.request("issuer", "https://pod.example/", new AbortController().signal),
    /unavailable/,
  );
  for (const port of ports) port.close();
});

test("a duplicate page reply cannot settle a completed bridge operation twice", async () => {
  const closed = [];
  class Channel {
    port1 = { postMessage() {}, close: () => closed.push("worker") };
    port2 = { close: () => closed.push("page") };
  }
  let channel;
  vi.stubGlobal(
    "MessageChannel",
    class extends Channel {
      constructor() {
        super();
        channel = this;
      }
    },
  );
  const scope = {
    clients: {
      matchAll: async () => [
        {
          focused: true,
          postMessage() {
            channel.port1.onmessage({ data: { ok: true, value: "https://app.example/cb?code=c" } });
            channel.port1.onmessage({
              data: { ok: false, name: "LateError", message: "too late" },
            });
          },
        },
      ],
    },
  };
  const code = await new BridgedCodeProvider(new WindowBridge(scope)).getCode(
    new URL("https://issuer.example/authorize"),
    new AbortController().signal,
  );
  assert.equal(code.value, "https://app.example/cb?code=c");
  code[Symbol.dispose]();
  assert.deepEqual(closed, ["worker"]);
});

test("an abort after a page request was sent cancels that request through its port", async () => {
  const controller = new AbortController();
  const cancelled = Promise.withResolvers();
  let pagePort;
  const scope = {
    clients: {
      matchAll: async () => [
        {
          focused: true,
          postMessage(_message, [port]) {
            pagePort = port;
            port.onmessage = (event) => cancelled.resolve(event.data);
            controller.abort(new Error("page navigated"));
          },
        },
      ],
    },
  };
  await assert.rejects(
    new WindowBridge(scope).request("code", "https://issuer.example/a", controller.signal),
    /page navigated/,
  );
  assert.deepEqual(await cancelled.promise, { type: "cancel" });
  pagePort.close();
});
