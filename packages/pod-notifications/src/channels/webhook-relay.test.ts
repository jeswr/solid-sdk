// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, test, vi } from "vitest";
import { createNotifications } from "../client.js";
import { FakeEventSource, FakeTimers } from "../testing.js";
import type { ChangeEvent } from "../types.js";
import { registerRelay } from "./relay-registration.js";
import { createWebhookRelayChannel } from "./webhook-relay.js";

function fixture() {
  const root = "https://pod.example/pod/";
  const description = "https://pod.example/description";
  const endpoint = `${root}webhooks`;
  const storage = createMemoryStorage({ protocol: "lws", root });
  storage.features.liveUpdates = {
    state: "available",
    evidence: "fixture",
    detail: { channels: ["webhook"] },
  };
  const timers = new FakeTimers();
  const sources: FakeEventSource[] = [];
  const id = "a".repeat(32);
  const registration = {
    id,
    inbox: `https://relay.example/inbox/${id}`,
    streamToken: "b".repeat(43),
  };
  const relayFetch = vi.fn<typeof fetch>(async () => Response.json(registration, { status: 201 }));
  const podFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") return Response.json({ subscription: `${root}subscription` });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "OPTIONS") return new Response(null);
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: { link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"` },
      });
    if (url === description)
      return Response.json(
        {
          "@context": "https://www.w3.org/ns/lws/v1",
          id: description,
          type: "Storage",
          service: [
            { type: "StorageRoot", serviceEndpoint: root },
            {
              type: "NotificationService",
              serviceEndpoint: `${root}sse`,
              subscriptionType: ["https://jeswr.org/ns/solid-sd#SseSubscription"],
            },
            {
              type: "NotificationService",
              serviceEndpoint: endpoint,
              subscriptionType: ["WebhookSubscription"],
            },
          ],
        },
        { headers: { "content-type": "application/lws+cid" } },
      );
    throw new Error("Unexpected pod request");
  });
  const getIdToken = vi.fn(async () => "session-id-token");
  const deps = {
    storage,
    fetch: podFetch,
    relay: { url: "https://relay.example", fetch: relayFetch, getIdToken },
    timers,
    now: timers.now,
    random: () => 0.5,
    eventSourceFactory: (url: string) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
  };
  return {
    root,
    description,
    endpoint,
    registration,
    deps,
    storage,
    timers,
    sources,
    relayFetch,
    podFetch,
    getIdToken,
    client: createNotifications(deps),
    posts: () => podFetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("registers canonical storage with an ID token, batches topics and opens a relay SSE capability", async () => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root, f.root], { hot: [`${f.root}note`] });
  expect(sub.channel).toBe("webhook-relay");
  await f.timers.advanceBy(0);
  expect(f.relayFetch).toHaveBeenCalledWith(
    "https://relay.example/register",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: { authorization: "Bearer session-id-token", "content-type": "application/json" },
      body: JSON.stringify({ storage: f.description }),
    }),
  );
  expect(f.posts()).toHaveLength(1);
  expect(f.posts()[0]?.[0]).toBe(f.endpoint);
  expect(JSON.parse(f.posts()[0]?.[1]?.body as string)).toEqual({
    "@context": ["https://www.w3.org/ns/lws/v1"],
    type: "https://www.w3.org/ns/lws#WebhookSubscription",
    topic: [f.root, `${f.root}note`],
    inbox: f.registration.inbox,
    expires: new Date(86_400_000).toISOString(),
  });
  expect(f.sources[0]?.url).toBe(
    `https://relay.example/stream/${f.registration.id}?token=${f.registration.streamToken}`,
  );
  f.sources[0]!.open();
  expect(sub.state).toBe("live");
  const changes: ChangeEvent[] = [];
  sub.on("change", (change) => changes.push(change));
  f.sources[0]!.message(
    JSON.stringify({
      type: "Notification",
      storage: f.description,
      activity: [{ id: "n", type: "Update", object: `${f.root}note` }],
    }),
    "1",
  );
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ via: "webhook-relay", object: `${f.root}note` });
  f.sources[0]!.message(
    JSON.stringify({
      type: "Notification",
      storage: "https://foreign.example/",
      activity: [{ id: "bad", type: "Update", object: `${f.root}note` }],
    }),
    "2",
  );
  expect(changes).toHaveLength(1);
  const resync = vi.fn();
  sub.on("resync", resync);
  expect(f.sources[0]!.reconnect()).toEqual({ "Last-Event-ID": "2" });
  expect(sub.state).toBe("degraded");
  await f.timers.advanceBy(1000);
  expect(f.sources).toHaveLength(1);
  f.sources[0]!.open();
  expect(resync).toHaveBeenCalledTimes(1);
  await sub.close();
  expect(f.sources[0]!.readyState).toBe(2);
  expect(f.podFetch).toHaveBeenCalledWith(`${f.root}subscription`, {
    method: "DELETE",
    redirect: "error",
  });
  expect(f.timers.pending).toBe(0);
});

test("terminal SSE failure rediscovers, registers again, and cleans up LWS subscriptions", async () => {
  const f = fixture();
  const sub = createWebhookRelayChannel({ ...f.deps, topics: [f.root] });
  await f.timers.advanceBy(0);
  f.sources[0]!.open();
  f.sources[0]!.readyState = 2;
  f.sources[0]!.error();
  await f.timers.advanceBy(1000);
  expect(f.relayFetch).toHaveBeenCalledTimes(2);
  expect(f.posts()).toHaveLength(2);
  f.sources[1]!.open();
  expect(sub.state).toBe("live");
  await sub.close();
});

test("registration 403 closes forbidden; transient errors retry and aborted ID-token callbacks cannot register", async () => {
  const f = fixture();
  f.relayFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
  const sub = await f.client.subscribe([f.root]);
  const state = vi.fn();
  sub.on("state", state);
  await f.timers.advanceBy(0);
  expect(state).toHaveBeenCalledWith("closed", "forbidden");
  expect(f.posts()).toHaveLength(0);
  const g = fixture();
  let resolve!: (token: string) => void;
  g.getIdToken.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = await g.client.subscribe([g.root]);
  const cycle = g.timers.advanceBy(0);
  await vi.waitFor(() => expect(g.getIdToken).toHaveBeenCalled());
  await pending.close();
  resolve("token");
  await cycle;
  expect(g.relayFetch).not.toHaveBeenCalled();
  expect(g.posts()).toHaveLength(0);
  const h = fixture();
  h.relayFetch.mockRejectedValueOnce(new Error("network"));
  const retry = await h.client.subscribe([h.root]);
  await h.timers.advanceBy(0);
  expect(retry.state).toBe("degraded");
  await h.timers.advanceBy(1000);
  expect(h.posts()).toHaveLength(1);
  await retry.close();
});

test("refuses untrusted relay URL/response and invalid ID tokens before pod subscription", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  for (const relay of [undefined, { url: "https://relay.example" }])
    await expect(
      registerRelay({ ...f.deps, relay }, f.description, signal, () => {}),
    ).rejects.toThrow("ID token");
  for (const url of [
    "http://relay.example",
    "https://relay.example/prefix",
    "https://relay.example/?q=secret",
    "https://user:secret@relay.example/",
  ]) {
    await expect(
      registerRelay(
        { ...f.deps, relay: { ...f.deps.relay, url } },
        f.description,
        signal,
        () => {},
      ),
    ).rejects.toThrow();
  }
  for (const token of ["", "a b"]) {
    f.getIdToken.mockResolvedValueOnce(token);
    await expect(registerRelay(f.deps, f.description, signal, () => {})).rejects.toThrow(
      "ID token",
    );
  }
  for (const data of [
    null,
    [],
    {},
    { id: 42 },
    { id: "bad" },
    { id: f.registration.id },
    { ...f.registration, streamToken: 42 },
    { ...f.registration, streamToken: "bad" },
    { ...f.registration, inbox: undefined },
    { ...f.registration, inbox: "https://evil.example/inbox/x" },
  ]) {
    f.relayFetch.mockResolvedValueOnce(Response.json(data));
    await expect(registerRelay(f.deps, f.description, signal, () => {})).rejects.toThrow(
      "registration",
    );
  }
  f.relayFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
  await expect(registerRelay(f.deps, f.description, signal, () => {})).rejects.toThrow("failed");
  const response = Response.json(f.registration);
  Object.defineProperty(response, "redirected", { value: true });
  f.relayFetch.mockResolvedValueOnce(response);
  await expect(registerRelay(f.deps, f.description, signal, () => {})).rejects.toThrow("failed");
  vi.stubGlobal("fetch", f.relayFetch);
  expect(
    await registerRelay(
      { ...f.deps, relay: { url: "https://relay.example", getIdToken: f.getIdToken } },
      f.description,
      signal,
      () => {},
    ),
  ).toMatchObject({ inbox: f.registration.inbox });
  const abort = new AbortController();
  f.relayFetch.mockImplementationOnce(async () => {
    abort.abort();
    return Response.json(f.registration);
  });
  await expect(registerRelay(f.deps, f.description, abort.signal, () => {})).rejects.toThrow();
});

test("ignores a late registration 403 after close", async () => {
  const f = fixture();
  let complete!: (response: Response) => void;
  f.relayFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const sub = await f.client.subscribe([f.root]);
  const state = vi.fn();
  sub.on("state", state);
  const cycle = f.timers.advanceBy(0);
  await vi.waitFor(() => expect(f.relayFetch).toHaveBeenCalled());
  await sub.close();
  complete(new Response(null, { status: 403 }));
  await cycle;
  expect(state).not.toHaveBeenCalledWith("closed", "forbidden");
  expect(f.sources).toHaveLength(0);
});

test("does not open a stream when close races the completed registration", async () => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  const response = Response.json(f.registration);
  response.json = () => {
    queueMicrotask(() =>
      queueMicrotask(() => {
        void sub.close();
      }),
    );
    return Promise.resolve(f.registration);
  };
  f.relayFetch.mockResolvedValueOnce(response);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("closed");
  expect(f.sources).toHaveLength(0);
  expect(f.posts()).toHaveLength(0);
});
