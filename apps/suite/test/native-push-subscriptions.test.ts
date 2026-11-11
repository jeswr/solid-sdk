// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { StorageDescription } from "@jeswr/storage-capabilities";
import { resolveStorageDescription } from "@jeswr/storage-capabilities";
import type { PushSubscriptionRequest, PushTopicSpec } from "@jeswr/suite-native/push";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import { createPushSubscriptions } from "../src/shell/push/subscriptions";

vi.mock("@jeswr/storage-capabilities", () => ({ resolveStorageDescription: vi.fn() }));
const NS = "http://www.w3.org/ns/solid/notifications#";
const storage = "https://pod.example/alice/";
const endpoint = "https://pod.example/.notifications/WebhookChannel2023/";
const channel = `${endpoint}one`;
const initialTopic: PushTopicSpec = {
  index: 0,
  kind: "inbox",
  topic: `${storage}inbox/`,
  label: "Inbox",
  route: "/notifications",
  enabled: true,
};
const request: PushSubscriptionRequest = {
  accountId: "alice",
  webId: "https://id.example/alice#me",
  protocol: "solid",
  storage,
  inbox: "https://relay.example/inbox/registration/secret",
  requestedExpiresAt: 800_000_000,
  topics: [initialTopic],
  signal: new AbortController().signal,
};
function description(protocol: "solid" | "lws" = "solid", service = endpoint): StorageDescription {
  return {
    id: storage,
    root: storage,
    protocol,
    descriptionUrl: null,
    owner: null,
    capabilities: [],
    sources: [],
    fetchedAt: 0,
    etag: null,
    maxAgeMs: 0,
    verificationMethods: [],
    services: [
      {
        endpoint: service,
        type: [
          protocol === "solid"
            ? "https://jeswr.org/ns/solid-sd#SolidNotificationService"
            : "https://www.w3.org/ns/lws#NotificationService",
        ],
        extra:
          protocol === "solid"
            ? { [`${NS}channelType`]: `${NS}WebhookChannel2023` }
            : { subscriptionType: ["https://www.w3.org/ns/lws#WebhookSubscription"] },
      },
    ],
  };
}
function turtle(
  overrides: { topic?: string; expires?: string; sender?: string; channel?: string } = {},
): Response {
  const returnedChannel = overrides.channel ?? channel;
  return new Response(
    `@prefix n: <${NS}>.
    <${returnedChannel}> a n:WebhookChannel2023; n:topic <${overrides.topic ?? request.topics[0]?.topic}>;
    n:sendTo <${request.inbox}>; n:endAt "${overrides.expires ?? new Date(500_000_000).toISOString()}".
    ${overrides.sender ? `<${returnedChannel}> n:sender <${overrides.sender}>.` : ""}`,
    { headers: { "content-type": "text/turtle" } },
  );
}
beforeEach(() => {
  vi.mocked(resolveStorageDescription).mockResolvedValue(description());
});

it("writes a typed seven-day request, retains actual expiry and sender, and keeps labels out of relay metadata", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    turtle({ sender: "https://pod.example/sender#me" }),
  );
  const callbacks = createPushSubscriptions(
    () => transport,
    () => 0,
  );
  const bound = await callbacks.subscribe(request);
  expect(bound).toEqual([
    {
      index: 0,
      kind: "inbox",
      topic: `${storage}inbox/`,
      channel,
      expiresAt: 500_000_000,
      sender: "https://pod.example/sender#me",
    },
  ]);
  const [url, init] = transport.mock.calls[0] ?? [];
  expect(url).toBe(endpoint);
  expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
  const dataset = await parseRdf(String(init?.body), "text/turtle");
  const subject = dataset.getSubjects(DataFactory.namedNode(`${NS}sendTo`), null, null)[0];
  expect(subject).toBeDefined();
  if (!subject) throw new Error("Missing subscription subject");
  const node = new TermWrapper(subject, dataset, DataFactory);
  expect(OptionalFrom.subjectPredicate(node, `${NS}sendTo`, NamedNodeAs.string)).toBe(
    request.inbox,
  );
  expect(dataset.getObjects(subject, DataFactory.namedNode(`${NS}endAt`), null)[0]?.value).toBe(
    new Date(request.requestedExpiresAt).toISOString(),
  );
});

it("batches LWS topics in one subscription and deduplicates deletion", async () => {
  vi.mocked(resolveStorageDescription).mockResolvedValue(description("lws"));
  const transport = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "DELETE"
      ? new Response(null, { status: 404 })
      : Response.json({ subscription: channel, expires: new Date(500_000_000).toISOString() }),
  );
  const callbacks = createPushSubscriptions(
    () => transport,
    () => 0,
  );
  const next = {
    ...request,
    protocol: "lws" as const,
    topics: [
      ...request.topics,
      { ...initialTopic, index: 1, kind: "chat" as const, topic: `${storage}chat/room/` },
    ],
  };
  const topics = await callbacks.subscribe(next);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toMatchObject({
    type: "WebhookSubscription",
    inbox: request.inbox,
    topic: next.topics.map((topic) => topic.topic),
    expires: new Date(request.requestedExpiresAt).toISOString(),
  });
  await callbacks.remove({
    accountId: "alice",
    protocol: "lws",
    storage,
    topics,
    signal: request.signal,
  });
  expect(transport).toHaveBeenCalledTimes(2);
});

it.each([
  "https://evil.example/subscribe",
  "http://pod.example/subscribe",
  "https://u@pod.example/subscribe",
])("refuses an unsafe service before POST: %s", async (endpoint) => {
  vi.mocked(resolveStorageDescription).mockResolvedValue(description("solid", endpoint));
  const transport = vi.fn<typeof fetch>();
  await expect(createPushSubscriptions(() => transport).subscribe(request)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it("refuses out-of-storage topics and unsupported services", async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    createPushSubscriptions(() => transport).subscribe({
      ...request,
      topics: [{ ...initialTopic, topic: "https://evil.example/inbox/" }],
    }),
  ).rejects.toThrow();
  vi.mocked(resolveStorageDescription).mockResolvedValue({ ...description(), services: [] });
  await expect(createPushSubscriptions(() => transport).subscribe(request)).rejects.toThrow(
    "does not offer",
  );
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  { expires: "yesterday" },
  { expires: new Date(0).toISOString() },
  { topic: `${storage}other/` },
  { sender: "http://pod.example/sender" },
])("cleans up channels with malformed or unbound metadata %j", async (overrides) => {
  const transport = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "DELETE" ? new Response(null, { status: 204 }) : turtle(overrides),
  );
  await expect(
    createPushSubscriptions(
      () => transport,
      () => 0,
    ).subscribe(request),
  ).rejects.toThrow();
  expect(transport.mock.calls.at(-1)).toMatchObject([
    channel,
    { method: "DELETE", redirect: "error" },
  ]);
});

it("rolls back earlier topics when later setup fails, and refuses foreign cleanup URLs", async () => {
  let count = 0;
  const transport = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : ++count === 1
        ? turtle()
        : new Response(null, { status: 403 }),
  );
  const callbacks = createPushSubscriptions(
    () => transport,
    () => 0,
  );
  await expect(
    callbacks.subscribe({
      ...request,
      topics: [...request.topics, { ...initialTopic, index: 1 }],
    }),
  ).rejects.toThrow();
  expect(transport.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  transport.mockClear();
  await expect(
    callbacks.remove({
      accountId: "alice",
      protocol: "solid",
      storage,
      topics: [
        {
          index: 0,
          kind: "inbox",
          topic: storage,
          channel: "https://evil.example/delete",
          expiresAt: 10,
        },
      ],
      signal: request.signal,
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it("parses the bundled JSON-LD context but refuses remote contexts and oversized bodies", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json(
      {
        "@context": "https://www.w3.org/ns/solid/notifications-context/v1",
        id: channel,
        type: "WebhookChannel2023",
        topic: request.topics[0]?.topic,
        sendTo: request.inbox,
        endAt: new Date(500_000_000).toISOString(),
      },
      { headers: { "content-type": "application/ld+json" } },
    ),
  );
  const callbacks = createPushSubscriptions(
    () => transport,
    () => 0,
  );
  expect(await callbacks.subscribe(request)).toHaveLength(1);
  transport.mockImplementation(async () => new Response("x".repeat(65_537)));
  await expect(callbacks.subscribe(request)).rejects.toThrow("too large");
  transport.mockImplementation(async () =>
    Response.json(
      { "@context": "https://evil.example/context" },
      { headers: { "content-type": "application/ld+json" } },
    ),
  );
  await expect(callbacks.subscribe(request)).rejects.toThrow();
});

it.each([
  `${storage}important.ttl`,
  endpoint,
  `${endpoint}?delete=all`,
  `${endpoint}../private.ttl`,
])("never deletes an arbitrary resource named as a returned channel: %s", async (returnedChannel) => {
  const transport = vi.fn<typeof fetch>(async () => turtle({ channel: returnedChannel }));
  await expect(
    createPushSubscriptions(
      () => transport,
      () => 0,
    ).subscribe(request),
  ).rejects.toThrow();
  expect(transport.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});

it("validates every cleanup URL before any deletion and needs no session for expired subscriptions", async () => {
  const transport = vi.fn<typeof fetch>();
  const fetchFor = vi.fn(() => transport);
  const callbacks = createPushSubscriptions(fetchFor, () => 100);
  const valid = {
    index: 0,
    kind: "inbox" as const,
    topic: `${storage}inbox/`,
    channel,
    expiresAt: 200,
  };
  await expect(
    callbacks.remove({
      accountId: "alice",
      protocol: "solid",
      storage,
      topics: [valid, { ...valid, channel: `${storage}important.ttl` }],
      signal: request.signal,
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  fetchFor.mockClear();
  await callbacks.remove({
    accountId: "signed-out",
    protocol: "solid",
    storage,
    topics: [{ ...valid, expiresAt: 99 }],
    signal: request.signal,
  });
  expect(fetchFor).not.toHaveBeenCalled();
});

it("discovers LWS through a topic within StorageRoot while registering the distinct canonical storage ID", async () => {
  const storageId = "https://pod.example/.well-known/storage/alice";
  vi.mocked(resolveStorageDescription).mockResolvedValue({ ...description("lws"), id: storageId });
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({ subscription: channel, expires: new Date(500_000_000).toISOString() }),
  );
  const result = await createPushSubscriptions(
    () => transport,
    () => 0,
  ).subscribe({ ...request, protocol: "lws", storage: storageId });
  expect(result).toHaveLength(1);
  expect(resolveStorageDescription).toHaveBeenLastCalledWith(
    request.topics[0]?.topic,
    expect.anything(),
  );
});

it("cancels a stalled response reader on sign-out", async () => {
  const controller = new AbortController();
  let reading = () => {};
  const started = new Promise<void>((resolve) => {
    reading = resolve;
  });
  const cancel = vi.fn();
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream({
          start() {
            reading();
          },
          cancel,
        }),
        { headers: { "content-type": "text/turtle" } },
      ),
  );
  const pending = createPushSubscriptions(
    () => transport,
    () => 0,
  ).subscribe({ ...request, signal: controller.signal });
  await started;
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(cancel).toHaveBeenCalled();
});
