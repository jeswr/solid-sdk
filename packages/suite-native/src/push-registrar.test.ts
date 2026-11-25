// AUTHORED-BY Codex GPT-6
import { describe, expect, test, vi } from "vitest";
import {
  createPushRegistrar,
  type PushClient,
  type PushKeys,
  type PushRegistrarOptions,
  type PushRegistrarState,
  type PushRegistrationRequest,
} from "./push.js";

const DAY = 86_400_000;
const relayUrl = "https://relay.example";
const spec: PushRegistrationRequest = {
  accountId: "account-a",
  webId: "https://pod.example/alice#me",
  protocol: "solid",
  storage: "https://pod.example/alice/",
  topics: [
    {
      index: 0,
      kind: "inbox",
      topic: "https://pod.example/alice/inbox/",
      label: "Inbox",
      route: "/notifications",
      enabled: true,
    },
  ],
};
function fixture(
  settings: { saved?: PushRegistrarState; fetchFor?: boolean; defaults?: boolean } = {},
) {
  let now = 1_800_000_000_000;
  let stored = settings.saved ? structuredClone(settings.saved) : null;
  let installations = 0;
  const registrations = new Set<string>();
  const requests: { url: string; method: string; body: unknown; init: RequestInit }[] = [];
  let intercept:
    | ((url: string, init: RequestInit) => Response | Promise<Response> | undefined)
    | undefined;
  const keys: PushKeys = {
    pushToken: "os-push-token",
    devicePublicKey: "public-point",
    authSecret: "auth-secret",
    deviceSigningKey: { kty: "EC", crv: "P-256", x: "x", y: "y" },
  };
  const push: PushClient = {
    status: vi.fn(async () => ({
      permission: "granted",
      platform: "android",
      installed: true,
      registrationStale: false,
    })),
    enable: vi.fn(async () => structuredClone(keys)),
    sign: vi.fn(async () => ({ proof: "device-proof" })),
    activate: vi.fn(async () => ({ nonce: "challenge-nonce" })),
    setTopicMap: vi.fn(async () => {}),
    silence: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    consumeLaunchRoute: vi.fn(async () => null),
    scheduleRenewalReminder: vi.fn(async () => {}),
  };
  const transport = vi.fn<typeof fetch>(async (input, raw) => {
    const url = String(input);
    const init = required(raw);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ url, method: required(init.method), body, init });
    const overridden = await intercept?.(url, init);
    if (overridden) return overridden;
    const path = new URL(url).pathname;
    if (path === "/push/installations") {
      installations++;
      return Response.json(
        { installationId: `install-${installations}`, activated: false, challengeSent: true },
        { status: 201 },
      );
    }
    if (path.endsWith("/activate") || init.method === "DELETE")
      return new Response(null, { status: 204 });
    if (init.method === "PATCH")
      return Response.json({ installationId: path.split("/").at(-1), activated: true });
    const id = required(path.split("/")[3]);
    if (path.endsWith("/rotate-inbox"))
      return Response.json({ inbox: `${relayUrl}/inbox/${id}/${"B".repeat(43)}` });
    if (!registrations.has(id)) {
      registrations.add(id);
      return Response.json(
        { registrationId: id, inbox: `${relayUrl}/inbox/${id}/${"A".repeat(43)}` },
        { status: 201 },
      );
    }
    return Response.json({ registrationId: id });
  });
  const store = {
    load: vi.fn(async () => structuredClone(stored)),
    save: vi.fn(async (value: PushRegistrarState) => {
      stored = structuredClone(value);
    }),
  };
  const subscriptions = {
    subscribe: vi.fn<PushRegistrarOptions["subscriptions"]["subscribe"]>(async (request) =>
      request.topics.map((topic) => ({
        index: topic.index,
        kind: topic.kind,
        topic: topic.topic,
        channel: "https://pod.example/subscriptions/1",
        expiresAt: request.requestedExpiresAt,
      })),
    ),
    remove: vi.fn<PushRegistrarOptions["subscriptions"]["remove"]>(async () => {}),
  };
  const fetchFor = vi.fn((_accountId: string) => transport);
  const options: PushRegistrarOptions = {
    relayUrl,
    fetch: transport,
    push,
    store,
    subscriptions,
    ...(settings.defaults ? {} : { cleanupFetch: transport, clock: () => now }),
    ...(settings.fetchFor === false ? {} : { fetchFor }),
  };
  const registrar = createPushRegistrar(options);
  return {
    registrar,
    options,
    push,
    transport,
    subscriptions,
    store,
    keys,
    requests,
    fetchFor,
    saved: () => stored,
    at: (time: number) => {
      now = time;
    },
    now: () => now,
    intercept: (fn: typeof intercept) => {
      intercept = fn;
    },
  };
}
async function enabled() {
  const f = fixture();
  await f.registrar.enable(spec);
  return f;
}

test("creates and activates an installation, bootstraps registration before pod subscribe, binds and stores only metadata", async () => {
  const f = await enabled();
  const snapshot = await f.registrar.snapshot();
  const entry = required(snapshot.registrations[0]);
  expect(snapshot.installationId).toBe("install-1");
  expect(entry.accountId).toBe(spec.accountId);
  expect(f.requests.map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([
    "POST /push/installations",
    "POST /push/installations/install-1/activate",
    `PUT /push/registrations/${entry.registrationId}`,
    `PUT /push/registrations/${entry.registrationId}`,
  ]);
  expect(required(f.requests[0]).body).toEqual({ ...f.keys, platform: "android" });
  expect(required(f.requests[1]).body).toEqual({ nonce: "challenge-nonce" });
  expect((required(f.requests[2]).body as { topics: unknown[] }).topics).toEqual([]);
  expect(f.subscriptions.subscribe).toHaveBeenCalledWith({
    ...spec,
    inbox: entry.inbox,
    requestedExpiresAt: f.now() + 7 * DAY,
    signal: expect.any(AbortSignal),
  });
  expect(f.push.setTopicMap).toHaveBeenCalledWith({
    registrationId: entry.registrationId,
    topics: [{ index: 0, kind: "inbox", label: "Inbox", route: "/notifications", enabled: true }],
    pushToken: f.keys.pushToken,
  });
  expect(f.push.scheduleRenewalReminder).toHaveBeenLastCalledWith({ expiresAt: f.now() + 7 * DAY });
  expect(
    f.requests.every(
      ({ init }) =>
        init.credentials === "omit" &&
        init.redirect === "error" &&
        new Headers(init.headers).get("installation-proof") === "device-proof",
    ),
  ).toBe(true);
  expect(f.fetchFor).toHaveBeenCalledWith(spec.accountId);
  expect(JSON.stringify(snapshot)).not.toContain("os-push-token");
  expect(JSON.stringify(snapshot)).not.toContain("auth-secret");
  snapshot.registrations.length = 0;
  expect((await f.registrar.snapshot()).registrations).toHaveLength(1);
});
test("refreshes relay registrations on each resume but renews pod channels only below two days, preserving actual expiry and sender", async () => {
  const f = await enabled();
  f.requests.length = 0;
  await f.registrar.renew(spec.accountId);
  expect(f.requests.map(({ method }) => method)).toEqual(["PATCH", "PUT"]);
  expect(f.subscriptions.subscribe).toHaveBeenCalledTimes(1);
  f.at(f.now() + 5 * DAY);
  await f.registrar.renew(spec.accountId);
  expect(f.subscriptions.subscribe).toHaveBeenCalledTimes(1);
  f.at(f.now() + 1);
  f.subscriptions.subscribe.mockImplementationOnce(async (request) =>
    request.topics.map((topic) => ({
      index: topic.index,
      kind: topic.kind,
      topic: topic.topic,
      channel: "https://pod.example/subscriptions/2",
      sender: "https://pod.example/sender#me",
      expiresAt: f.now() + 3 * DAY,
    })),
  );
  await f.registrar.renew(spec.accountId);
  expect(f.subscriptions.remove).toHaveBeenCalledWith(
    expect.objectContaining({
      topics: [expect.objectContaining({ channel: "https://pod.example/subscriptions/1" })],
    }),
  );
  expect(
    required(required((await f.registrar.snapshot()).registrations[0]).topics[0]).expiresAt,
  ).toBe(f.now() + 3 * DAY);
  expect(f.push.scheduleRenewalReminder).toHaveBeenLastCalledWith({ expiresAt: f.now() + 3 * DAY });
});
test("installation shared by four independent registrations, account cleanup leaves others enabled", async () => {
  const f = await enabled();
  await f.registrar.enable({ ...spec, storage: "https://pod.example/second/" });
  await f.registrar.enable({
    ...spec,
    accountId: "account-b",
    webId: "https://pod.example/bob#me",
  });
  await f.registrar.enable({
    ...spec,
    accountId: "account-c",
    webId: "https://pod.example/charlie#me",
  });
  await expect(f.registrar.enable({ ...spec, accountId: "account-d" })).rejects.toThrow();
  const a = (await f.registrar.snapshot()).registrations.filter(
    (entry) => entry.accountId === spec.accountId,
  );
  f.requests.length = 0;
  await f.registrar.remove(spec.accountId);
  expect(f.push.silence).toHaveBeenCalledWith({ registrationId: required(a[0]).registrationId });
  expect((await f.registrar.snapshot()).registrations.map((entry) => entry.accountId)).toEqual([
    "account-b",
    "account-c",
  ]);
  expect(f.push.disable).not.toHaveBeenCalled();
  expect(f.requests.every(({ method }) => method === "DELETE")).toBe(true);
  expect(f.push.scheduleRenewalReminder).toHaveBeenLastCalledWith({ expiresAt: f.now() + 7 * DAY });
});
test("changing topics silences first and replaces channels, same account webId/protocol cannot drift", async () => {
  const f = await enabled();
  const changed = {
    ...spec,
    topics: [
      { ...required(spec.topics[0]), kind: "chat" as const, label: "Room", route: "/chat/room" },
    ],
  };
  await f.registrar.enable(changed);
  expect(f.push.silence).toHaveBeenCalled();
  expect(f.subscriptions.remove).toHaveBeenCalled();
  expect(
    required(required((await f.registrar.snapshot()).registrations[0]).requestedTopics[0]).kind,
  ).toBe("chat");
  await expect(
    f.registrar.enable({ ...spec, webId: "https://pod.example/foreign#me" }),
  ).rejects.toThrow();
  await expect(f.registrar.enable({ ...spec, protocol: "lws" })).rejects.toThrow();
});
test("failed cleanup silences immediately, preserves metadata/keys, uses tokenless proof and retries after relaunch", async () => {
  const f = await enabled();
  const id = required((await f.registrar.snapshot()).registrations[0]).registrationId;
  f.subscriptions.remove.mockRejectedValueOnce(new Error("offline"));
  f.intercept((_url, init) =>
    init.method === "DELETE" ? new Response(null, { status: 503 }) : undefined,
  );
  await f.registrar.remove(spec.accountId);
  expect(f.push.silence).toHaveBeenCalledWith({ registrationId: id });
  expect(f.push.disable).not.toHaveBeenCalled();
  expect(required(required(f.saved()).registrations[0]).removing).toBe(true);
  expect(f.push.scheduleRenewalReminder).toHaveBeenLastCalledWith({ expiresAt: null });
  expect(required(f.subscriptions.remove.mock.calls[0])[0].signal).toBeInstanceOf(AbortSignal);
  const reloaded = fixture({ saved: required(f.saved()) });
  reloaded.intercept((_url, init) =>
    init.method === "DELETE" ? new Response(null, { status: 404 }) : undefined,
  );
  await reloaded.registrar.retryCleanup();
  expect((await reloaded.registrar.snapshot()).registrations).toEqual([]);
  expect((await reloaded.registrar.snapshot()).installationId).toBeNull();
  expect(reloaded.push.disable).toHaveBeenCalledWith({ deleteLocalData: true });
  expect(reloaded.fetchFor).not.toHaveBeenCalled();
});
test("pod cleanup failure does not prevent relay deletion and retained rows retry", async () => {
  const f = await enabled();
  f.subscriptions.remove.mockRejectedValueOnce(new Error("pod offline"));
  await f.registrar.remove(spec.accountId);
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(true);
  expect((await f.registrar.snapshot()).registrations).toHaveLength(1);
  await f.registrar.retryCleanup();
  expect((await f.registrar.snapshot()).registrations).toEqual([]);
});
test("relay cleanup failure retains keys after pod deletion; last installation failure can retry", async () => {
  const f = await enabled();
  let fails = true;
  f.intercept((url, init) =>
    init.method === "DELETE" && fails
      ? new Response(null, { status: 503 })
      : url.includes("/installations/") && init.method === "DELETE"
        ? new Response(null, { status: 503 })
        : undefined,
  );
  await f.registrar.remove(spec.accountId);
  expect(required((await f.registrar.snapshot()).registrations[0]).topics).toEqual([]);
  fails = false;
  await f.registrar.retryCleanup();
  expect((await f.registrar.snapshot()).installationId).toBe("install-1");
  expect(f.push.disable).not.toHaveBeenCalled();
  f.intercept(undefined);
  await f.registrar.retryCleanup();
  expect((await f.registrar.snapshot()).installationId).toBeNull();
});
test("successful last-account deletion is local-first and clears OS token only after relay acknowledgement", async () => {
  const f = await enabled();
  f.intercept((url, init) => {
    if (init.method === "DELETE") expect(f.push.silence).toHaveBeenCalled();
    if (url.includes("/installations/") && init.method === "DELETE")
      expect(f.push.disable).not.toHaveBeenCalled();
    return undefined;
  });
  await f.registrar.remove(spec.accountId);
  expect(f.push.disable).toHaveBeenCalledWith({ deleteLocalData: true });
  await f.registrar.remove("absent");
  await f.registrar.retryCleanup();
  await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
  await f.registrar.enable(spec);
  expect((await f.registrar.snapshot()).registrations).toHaveLength(1);
});
test("renews no unknown account and supports injected/default authenticated transports and clock", async () => {
  const f = fixture({ fetchFor: false });
  await f.registrar.renew("missing");
  expect(f.transport).not.toHaveBeenCalled();
  await f.registrar.enable(spec);
  expect(f.fetchFor).not.toHaveBeenCalled();
  const d = fixture({ defaults: true });
  vi.stubGlobal("fetch", d.transport);
  try {
    const registrar = createPushRegistrar(d.options);
    await registrar.enable(spec);
    await registrar.remove(spec.accountId);
    expect(d.transport).toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
test("recovers an expired relay installation and missing registration inbox without reusing secret URLs", async () => {
  const f = await enabled();
  f.intercept((_url, init) =>
    init.method === "PATCH" ? new Response(null, { status: 404 }) : undefined,
  );
  await f.registrar.renew(spec.accountId);
  expect((await f.registrar.snapshot()).installationId).toBe("install-2");
  expect(f.requests.some(({ url }) => url.endsWith("/rotate-inbox"))).toBe(true);
});
test("a changed native token requires challenge completion before maps are acknowledged", async () => {
  const f = await enabled();
  f.push.setTopicMap = vi.fn(async () => {});
  f.intercept((_url, init) =>
    init.method === "PATCH"
      ? Response.json({ installationId: "install-1", activated: false, challengeSent: true })
      : undefined,
  );
  await f.registrar.renew(spec.accountId);
  expect(f.push.activate).toHaveBeenCalledTimes(2);
  expect(f.push.setTopicMap).toHaveBeenCalledWith(
    expect.objectContaining({ pushToken: f.keys.pushToken }),
  );
});
test("challenge delivery failures retain installation for retry and permission denial performs no relay request", async () => {
  const f = fixture();
  f.intercept(() => Response.json({ installationId: "i", activated: false, challengeSent: false }));
  await expect(f.registrar.enable(spec)).rejects.toThrow();
  expect((await f.registrar.snapshot()).installationId).toBe("i");
  expect(f.subscriptions.subscribe).not.toHaveBeenCalled();
  f.intercept(() => Response.json({ installationId: "i", activated: false, challengeSent: true }));
  f.push.activate = vi.fn(async () => {
    throw new Error("activation timeout");
  });
  await expect(f.registrar.enable(spec)).rejects.toThrow("activation timeout");
  const denied = fixture();
  denied.push.status = vi.fn(async () => ({
    permission: "denied",
    installed: false,
    platform: "ios",
    registrationStale: false,
  }));
  await expect(denied.registrar.enable(spec)).rejects.toThrow();
  expect(denied.transport).not.toHaveBeenCalled();
});
test("signout aborts pending activation immediately and cannot later enable a signed-out account", async () => {
  const f = fixture();
  let resolve!: (value: { nonce: string }) => void;
  f.push.activate = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const enable = f.registrar.enable(spec);
  const failure = expect(enable).rejects.toThrow("Push operation cancelled");
  await vi.waitFor(() => expect(f.push.activate).toHaveBeenCalled());
  await f.registrar.remove(spec.accountId);
  await failure;
  resolve({ nonce: "late" });
  await Promise.resolve();
  expect(f.push.setTopicMap).not.toHaveBeenCalled();
  expect(f.push.disable).toHaveBeenCalledWith({ deleteLocalData: true });
});
test("signout silences a late native topic-map acknowledgement", async () => {
  const f = fixture();
  let resolve!: () => void;
  f.push.setTopicMap = vi
    .fn(async () => {})
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
  const enabling = f.registrar.enable(spec);
  const failure = expect(enabling).rejects.toThrow();
  await vi.waitFor(() => expect(f.push.setTopicMap).toHaveBeenCalled());
  const removing = f.registrar.remove(spec.accountId);
  await vi.waitFor(() => expect(f.push.silence).toHaveBeenCalled());
  resolve();
  await failure;
  await removing;
  expect(f.push.silence).toHaveBeenCalledTimes(3);
});
test("persisted removing rows cannot be enabled, save failures do not poison serialization", async () => {
  const f = await enabled();
  const state = await f.registrar.snapshot();
  required(state.registrations[0]).removing = true;
  const reloaded = fixture({ saved: state });
  await expect(reloaded.registrar.enable(spec)).rejects.toThrow();
  const broken = fixture();
  broken.store.save.mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(broken.registrar.enable(spec)).rejects.toThrow("disk unavailable");
  await broken.registrar.enable(spec);
  expect((await broken.registrar.snapshot()).registrations).toHaveLength(1);
});
test("failed replacement binding retains both old and new channels for cleanup", async () => {
  const f = await enabled();
  f.at(f.now() + 6 * DAY);
  let put = 0;
  f.intercept((_url, init) =>
    init.method === "PUT" && ++put === 2 ? new Response(null, { status: 503 }) : undefined,
  );
  await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
  expect(required((await f.registrar.snapshot()).registrations[0]).cleanupTopics).toHaveLength(1);
  f.intercept(undefined);
  await f.registrar.renew(spec.accountId);
  expect(required((await f.registrar.snapshot()).registrations[0]).cleanupTopics).toEqual([]);
});

describe("untrusted protocol and persistence", () => {
  test.each([
    { ...spec, accountId: "" },
    { ...spec, webId: "http://pod.example/#me" },
    { ...spec, storage: "https://u:p@pod.example/" },
    { ...spec, protocol: "unknown" },
    { ...spec, topics: [] },
    { ...spec, topics: null },
    { ...spec, topics: [...spec.topics, ...spec.topics] },
    { ...spec, topics: [{ ...spec.topics[0], topic: "http://evil.example/" }] },
    { ...spec, topics: Array.from({ length: 17 }, (_, index) => ({ ...spec.topics[0], index })) },
  ])("rejects invalid requested registration", (request) => {
    const f = fixture();
    expect(() => f.registrar.enable(request as never)).toThrow();
    expect(f.transport).not.toHaveBeenCalled();
  });
  test.each([
    null,
    {},
    { installationId: "bad/", activated: false },
    { installationId: "i", activated: "yes" },
    { installationId: "i", activated: false, challengeSent: "yes" },
  ])("rejects malformed installation response", async (data) => {
    const f = fixture();
    f.intercept(() => Response.json(data));
    await expect(f.registrar.enable(spec)).rejects.toThrow();
  });
  test("rejects installation id swaps and non-404 relay failures", async () => {
    const f = await enabled();
    f.intercept(() => Response.json({ installationId: "foreign", activated: true }));
    await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
    f.intercept(() => new Response(null, { status: 403 }));
    await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
  });
  test.each([
    { registrationId: "other" },
    { registrationId: "match", inbox: "https://evil.example/inbox/id/secret" },
    { registrationId: "match", inbox: "https://relay.example/elsewhere" },
    { registrationId: "match", inbox: "https://relay.example/inbox/id/secret?token=x" },
  ])("rejects unbound registration response", async (data) => {
    const f = fixture();
    f.intercept((url, init) =>
      init.method === "PUT"
        ? Response.json({
            ...data,
            registrationId:
              data.registrationId === "match"
                ? new URL(url).pathname.split("/").at(-1)
                : data.registrationId,
          })
        : undefined,
    );
    await expect(f.registrar.enable(spec)).rejects.toThrow();
    expect(f.subscriptions.subscribe).not.toHaveBeenCalled();
  });
  test.each([
    [],
    [
      {
        index: -1,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: 1,
      },
    ],
    [
      {
        index: 0,
        kind: "challenge",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: 1,
      },
    ],
    [
      {
        index: 0,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "http://evil.example/sub/1",
        expiresAt: 1,
      },
    ],
    [
      {
        index: 0,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        sender: "http://evil.example/sender",
        expiresAt: 1,
      },
    ],
    [
      {
        index: 0,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: 0,
      },
    ],
    [
      {
        index: 0,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: 1,
      },
    ],
    [
      {
        index: 2,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      {
        index: 0,
        kind: "chat",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      {
        index: 0,
        kind: "inbox",
        topic: "https://other.example/topic",
        channel: "https://pod.example/sub/1",
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      {
        index: 0,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
      {
        index: 0,
        kind: "inbox",
        topic: required(spec.topics[0]).topic,
        channel: "https://pod.example/sub/1",
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    null,
  ])("rejects malformed or mismatched pod bindings", async (topics) => {
    const f = fixture();
    f.subscriptions.subscribe.mockResolvedValueOnce(topics as never);
    await expect(f.registrar.enable(spec)).rejects.toThrow();
    expect(f.push.setTopicMap).not.toHaveBeenCalled();
  });
  test.each([
    {},
    { version: 2, relayUrl, installationId: null, registrations: [] },
    { version: 1, relayUrl: "https://other.example", installationId: null, registrations: [] },
    { version: 1, relayUrl, installationId: "bad/id", registrations: [] },
    { version: 1, relayUrl, installationId: null, registrations: [{}] },
    { version: 1, relayUrl, installationId: "i", registrations: null },
  ])("refuses malformed stored metadata", async (saved) => {
    const f = fixture({ saved: saved as PushRegistrarState });
    await expect(f.registrar.snapshot()).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
  });
  test("refuses duplicate or malformed stored registration rows", async () => {
    const f = await enabled();
    const saved = await f.registrar.snapshot();
    saved.registrations.push(required(saved.registrations[0]));
    await expect(fixture({ saved }).registrar.snapshot()).rejects.toThrow();
    saved.registrations.pop();
    required(saved.registrations[0]).removing = "no" as never;
    await expect(fixture({ saved }).registrar.snapshot()).rejects.toThrow();
  });
  test.each([
    "https://relay.example/path",
    "http://relay.example",
    "https://user:password@relay.example",
    "https://relay.example?query",
  ])("rejects unsafe relay configuration", (relayUrl) =>
    expect(() => createPushRegistrar({ ...fixture().options, relayUrl })).toThrow());
  test("rejects redirects, response locations and oversized JSON", async () => {
    const f = fixture();
    f.intercept(() => new Response("{}", { headers: { location: "https://evil.example" } }));
    await expect(f.registrar.enable(spec)).rejects.toThrow();
    f.intercept(() => {
      const response = Response.json({});
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    await expect(f.registrar.enable(spec)).rejects.toThrow();
    f.intercept(() => new Response(" ".repeat(65537)));
    await expect(f.registrar.enable(spec)).rejects.toThrow();
  });
});

test("bounds streamed response bytes before allocation and safely cancels a broken reader", async () => {
  const f = fixture();
  const cancel = vi.fn(async () => {
    throw new Error("cancel failed");
  });
  f.intercept(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65_537));
          },
          cancel,
        }),
      ),
  );
  await expect(f.registrar.enable(spec)).rejects.toThrow("Invalid push data");
  expect(cancel).toHaveBeenCalled();
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture");
  return value;
}

test("frees native registration slots after confirmed removal while another account remains live", async () => {
  const f = await enabled();
  await f.registrar.enable({ ...spec, accountId: "other" });
  const removed = required(
    (await f.registrar.snapshot()).registrations.find(
      (entry) => entry.accountId === spec.accountId,
    ),
  );
  f.push.setTopicMap = vi.fn(async () => {});
  await f.registrar.remove(spec.accountId);
  expect(f.push.setTopicMap).toHaveBeenCalledExactlyOnceWith({
    registrationId: removed.registrationId,
    topics: [],
  });
  expect(f.push.disable).not.toHaveBeenCalled();
});
test("a recovered registration inbox immediately replaces still-fresh pod subscriptions", async () => {
  const f = await enabled();
  f.intercept((_url, init) =>
    init.method === "PATCH" ? new Response(null, { status: 404 }) : undefined,
  );
  await f.registrar.renew(spec.accountId);
  expect(f.subscriptions.subscribe).toHaveBeenCalledTimes(2);
  expect(f.subscriptions.subscribe.mock.calls[1]?.[0].inbox).toContain("B".repeat(43));
  expect(f.subscriptions.remove).toHaveBeenCalled();
});
test("failed old-channel deletion prevents another channel batch accumulating on repeated short renewals", async () => {
  const f = await enabled();
  f.at(f.now() + 6 * DAY);
  f.subscriptions.subscribe.mockImplementation(async (request) =>
    request.topics.map((topic) => ({
      index: topic.index,
      kind: topic.kind,
      topic: topic.topic,
      channel: "https://pod.example/subscriptions/short",
      expiresAt: f.now() + DAY,
    })),
  );
  f.subscriptions.remove.mockRejectedValue(new Error("cannot delete"));
  await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
  await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
  expect(f.subscriptions.subscribe).toHaveBeenCalledTimes(2);
  expect((await f.registrar.snapshot()).registrations[0]?.cleanupTopics).toHaveLength(1);
});

test("signout during persistence consumes a late native activation rejection without reenabling", async () => {
  const f = fixture();
  let persist!: () => void;
  const original = f.store.save.getMockImplementation();
  f.store.save.mockImplementationOnce(async (value) => {
    await new Promise<void>((resolve) => {
      persist = resolve;
    });
    await original?.(value);
  });
  f.push.activate = vi.fn(async () => {
    throw new Error("late native activation failure");
  });
  const enabling = f.registrar.enable(spec);
  const rejected = expect(enabling).rejects.toThrow("Push operation cancelled");
  await vi.waitFor(() => expect(f.store.save).toHaveBeenCalled());
  const removing = f.registrar.remove(spec.accountId);
  persist();
  await rejected;
  await removing;
  expect(f.push.setTopicMap).not.toHaveBeenCalled();
});

test.each([
  "status",
  "enable",
] as const)("signout does not wait for a deferred native %s and consumes its late failure", async (method) => {
  const f = fixture();
  let fail!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  f.push[method] = vi.fn(() => pending);
  const enabling = f.registrar.enable(spec);
  const rejected = expect(enabling).rejects.toThrow("Push operation cancelled");
  await vi.waitFor(() => expect(f.push[method]).toHaveBeenCalled());
  await f.registrar.remove(spec.accountId);
  await rejected;
  fail(new Error("late native failure"));
  await Promise.resolve();
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.push.setTopicMap).not.toHaveBeenCalled();
  if (method === "status") expect(f.push.enable).not.toHaveBeenCalled();
});

test("signout during state load never asks native permission afterwards", async () => {
  const f = fixture();
  let loaded!: (value: PushRegistrarState | null) => void;
  f.store.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  const enabling = f.registrar.enable(spec);
  const rejected = expect(enabling).rejects.toThrow();
  await vi.waitFor(() => expect(f.store.load).toHaveBeenCalled());
  const removing = f.registrar.remove(spec.accountId);
  loaded(null);
  await rejected;
  await removing;
  expect(f.push.status).not.toHaveBeenCalled();
  expect(f.push.enable).not.toHaveBeenCalled();
});

test("a full retained channel batch stays loadable across inbox recovery and deletion failure", async () => {
  const f = fixture();
  const full = {
    ...spec,
    topics: Array.from({ length: 16 }, (_, index) => ({
      ...required(spec.topics[0]),
      index,
      topic: `https://pod.example/alice/topic-${index}/`,
    })),
  };
  await f.registrar.enable(full);
  f.at(f.now() + 6 * DAY);
  f.subscriptions.subscribe.mockImplementationOnce(async (request) =>
    request.topics.map((topic) => ({
      index: topic.index,
      kind: topic.kind,
      topic: topic.topic,
      channel: `https://pod.example/subscriptions/new-${topic.index}`,
      expiresAt: request.requestedExpiresAt,
    })),
  );
  let puts = 0;
  f.intercept((_url, init) =>
    init.method === "PUT" && ++puts === 2 ? new Response(null, { status: 503 }) : undefined,
  );
  await expect(f.registrar.renew(spec.accountId)).rejects.toThrow();
  const crashed = required(f.saved());
  expect(crashed.registrations[0]?.topics).toHaveLength(16);
  expect(crashed.registrations[0]?.cleanupTopics).toHaveLength(16);
  const restart = fixture({ saved: crashed });
  restart.intercept((_url, init) =>
    init.method === "PATCH" ? new Response(null, { status: 404 }) : undefined,
  );
  restart.subscriptions.remove.mockRejectedValueOnce(new Error("pod deletion unavailable"));
  await expect(restart.registrar.renew(spec.accountId)).rejects.toThrow("pod deletion unavailable");
  const retained = required(restart.saved());
  expect(retained.registrations[0]?.cleanupTopics).toHaveLength(16);
  expect(retained.registrations[0]?.topics).toHaveLength(16);
  expect(retained.registrations[0]?.inbox).toBeNull();
  // Every completed persistence boundary remains a loadable state, including the recovered install.
  for (const [saved] of restart.store.save.mock.calls)
    await expect(fixture({ saved }).registrar.snapshot()).resolves.toEqual(saved);
  const retry = fixture({ saved: retained });
  retry.subscriptions.remove
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error("retired current batch unavailable"));
  await expect(retry.registrar.renew(spec.accountId)).rejects.toThrow(
    "retired current batch unavailable",
  );
  expect(retry.subscriptions.subscribe).toHaveBeenCalledOnce();
  const rebound = required(retry.saved());
  expect(rebound.registrations[0]?.topics).toHaveLength(16);
  expect(rebound.registrations[0]?.cleanupTopics).toHaveLength(16);
  for (const [saved] of retry.store.save.mock.calls)
    await expect(fixture({ saved }).registrar.snapshot()).resolves.toEqual(saved);
  const final = fixture({ saved: rebound });
  await final.registrar.renew(spec.accountId);
  expect((await final.registrar.snapshot()).registrations[0]?.cleanupTopics).toEqual([]);
});

test("last-installation network cleanup cannot block signout and preserves keys for retry", async () => {
  const f = await enabled();
  f.intercept((url, init) => {
    if (init.method === "DELETE" && url.includes("/installations/")) throw new TypeError("offline");
    return undefined;
  });
  await f.registrar.remove(spec.accountId);
  expect((await f.registrar.snapshot()).registrations).toEqual([]);
  expect((await f.registrar.snapshot()).installationId).toBe("install-1");
  expect(f.push.disable).not.toHaveBeenCalled();
  f.intercept(undefined);
  await f.registrar.retryCleanup();
  expect((await f.registrar.snapshot()).installationId).toBeNull();
  expect(f.push.disable).toHaveBeenCalledWith({ deleteLocalData: true });
});
