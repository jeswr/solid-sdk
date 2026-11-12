// AUTHORED-BY Codex GPT-6.1-Sol
import { createInboxReader, type InboxNotification } from "@jeswr/pod-access/notify";
import { beforeEach, expect, it, vi } from "vitest";
import { encodeRef } from "../src/lib/refs";
import { mergeNotifications, UNDATED } from "../src/shell/lib/notifications-model";
import { createPodNotificationSource } from "../src/shell/notifications/pod-source";

vi.mock("@jeswr/pod-access/notify", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-access/notify")>()),
  createInboxReader: vi.fn(),
}));

const webId = "https://pod.example/profile/card#me";
const inboxUrl = "https://pod.example/inbox/";
const signal = () => new AbortController().signal;
const inbox = vi.fn<(webId: string) => Promise<string | null>>();
const list = vi.fn<ReturnType<typeof createInboxReader>["list"]>();
const fetch = vi.fn<typeof globalThis.fetch>();
const item = (fields: Partial<InboxNotification> = {}): InboxNotification => ({
  url: `${inboxUrl}one`,
  type: "Notification",
  ...fields,
});
const source = () => createPodNotificationSource({ webId, fetch });

beforeEach(() => {
  vi.resetAllMocks();
  inbox.mockResolvedValue(inboxUrl);
  list.mockResolvedValue([]);
  fetch.mockResolvedValue(new Response());
  vi.mocked(createInboxReader).mockReturnValue({ inbox, list, listPage: vi.fn() });
});

it.each([
  ["Announce", "Shared with you as Editor", undefined, "shared"],
  ["Announce", "Avery assigned you 'Review'", "https://pod.example/tracker", "task"],
  ["Create", "A mention", "https://pod.example/document", "comment"],
  ["Offer", "An invitation", undefined, "shared"],
  ["Request", "Please give me access", undefined, "system"],
] as const)("maps %s / %s without granting request semantics", async (type, summary, target, kind) => {
  list.mockResolvedValue([
    item({
      type,
      summary,
      ...(target ? { target } : {}),
      content: "  Notification content  ",
      actor: "https://avery.example/profile/card#me",
      published: "2026-11-01T12:30:00Z",
    }),
  ]);
  const pod = source();
  expect(pod.id).toBe("pod-inbox");
  expect(await pod.list(signal())).toEqual([
    {
      id: `${inboxUrl}one`,
      kind,
      title: summary,
      body: "Notification content",
      createdAt: new Date("2026-11-01T12:30:00Z"),
      read: false,
      actor: { name: "avery.example", webId: "https://avery.example/profile/card#me" },
      ...(type === "Create" ? { href: `/drive/p/${encodeRef(target ?? "")}` } : {}),
    },
  ]);
  expect(pod).not.toHaveProperty("markRead");
  expect(pod).not.toHaveProperty("subscribe");
  expect(fetch).not.toHaveBeenCalled(); // Actor profiles are never fetched.
});

it.each([
  [item({ type: "Announce", summary: "Shared with you as " }), "Shared with you as"],
  [item({ type: "Announce", target: "tracker" }), "A task was assigned to you"],
  [item({ type: "Create", target: "document" }), "You were mentioned in a comment"],
  [item({ type: "Offer" }), "You were invited to a room"],
  [item({ summary: "  ", content: "  " }), "New inbox notification"],
])("uses a stable kind fallback for %o", async (notification, title) => {
  list.mockResolvedValue([notification]);
  const [mapped] = await source().list(signal());
  expect(mapped?.title).toBe(title);
  expect(mapped).not.toHaveProperty("body");
  expect(mapped).not.toHaveProperty("request");
});

it("labels an actor IRI without a host conservatively", async () => {
  list.mockResolvedValue([item({ actor: "urn:actor:avery" })]);
  expect((await source().list(signal()))[0]?.actor).toEqual({
    name: "Unknown sender",
    webId: "urn:actor:avery",
  });
});

it("keeps missing/invalid dates stable and last, including before the Unix epoch", async () => {
  list.mockResolvedValue([
    item({ url: `${inboxUrl}missing` }),
    item({ url: `${inboxUrl}invalid`, published: "not a date", actor: "not a WebID" }),
    item({ url: `${inboxUrl}dated`, published: "1960-01-01T00:00:00Z" }),
  ]);
  const pod = source();
  const first = await pod.list(signal());
  expect(await pod.list(signal())).toEqual(first);
  expect(first[0]?.createdAt.getTime()).toBe(UNDATED);
  expect(first[1]?.actor).toEqual({ name: "Unknown sender", webId: "not a WebID" });
  expect(
    mergeNotifications([first], { read: new Set(), dismissed: new Set() }).map((n) => n.id),
  ).toEqual([`${inboxUrl}dated`, `${inboxUrl}invalid`, `${inboxUrl}missing`]);
});

it.each([
  [
    "https://pod.example/file.ttl#it",
    "Notification",
    undefined,
    "/drive/p/",
    "https://pod.example/file.ttl",
  ],
  ["http://pod.example/folder/", "Offer", undefined, "/drive/f/", "http://pod.example/folder/"],
  [
    "https://pod.example/tasks.ttl#one",
    "Announce",
    "https://pod.example/tracker",
    "/tasks/inbox?task=",
    "https://pod.example/tasks.ttl#one",
  ],
  [
    "https://pod.example/annotation",
    "Create",
    "https://pod.example/doc.ttl#it",
    "/drive/p/",
    "https://pod.example/doc.ttl",
  ],
] as const)("routes %s inside the suite", async (object, type, target, prefix, resource) => {
  list.mockResolvedValue([item({ object, type, ...(target ? { target } : {}) })]);
  expect((await source().list(signal()))[0]?.href).toBe(`${prefix}${encodeRef(resource)}`);
});

it.each([
  "javascript:alert(1)",
  "data:text/html,hi",
  "file:///tmp/file",
  "/relative",
  "invalid",
  "urn:task:1",
])("omits unsafe or unmappable hrefs: %s", async (object) => {
  list.mockResolvedValue([item({ object })]);
  expect((await source().list(signal()))[0]).not.toHaveProperty("href");
});

it("passes the authenticated fetch and clock to one reader, and the listing signal on each refresh", async () => {
  const clock = () => 1234;
  const pod = createPodNotificationSource({ webId, fetch, clock });
  const request = signal();
  await pod.list(request);
  await pod.list(signal());
  expect(createInboxReader).toHaveBeenCalledOnce();
  const options = vi.mocked(createInboxReader).mock.calls[0]?.[0];
  expect(options?.clock).toBe(clock);
  expect(inbox).toHaveBeenCalledWith(webId);
  const combined = list.mock.calls[0]?.[1]?.signal;
  expect(combined).toBeInstanceOf(AbortSignal);
  expect(list).toHaveBeenCalledWith(inboxUrl, { signal: combined });
  const response = await options?.fetch(inboxUrl);
  expect(response).toBeInstanceOf(Response);
  expect(fetch).toHaveBeenCalledWith(inboxUrl, { signal: expect.any(AbortSignal) });
  await options?.fetch(inboxUrl, { signal: request, method: "GET" });
  expect(fetch).toHaveBeenLastCalledWith(inboxUrl, {
    signal: expect.any(AbortSignal),
    method: "GET",
  });
});

it("returns [] for an absent inbox or an empty listing, and propagates reader failures", async () => {
  inbox.mockResolvedValueOnce(null);
  const pod = source();
  expect(await pod.list(signal())).toEqual([]);
  expect(list).not.toHaveBeenCalled();
  expect(await pod.list(signal())).toEqual([]);
  list.mockRejectedValueOnce(new Error("Inbox unavailable"));
  await expect(pod.list(signal())).rejects.toThrow("Inbox unavailable");
  inbox.mockRejectedValueOnce(new Error("Discovery failed"));
  await expect(pod.list(signal())).rejects.toThrow("Discovery failed");
});

it("aborts pending work and fences disposal even when the reader/fetch ignores abort", async () => {
  const pod = source();
  const options = vi.mocked(createInboxReader).mock.calls[0]?.[0];
  let deliver!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const pendingFetch = options?.fetch(inboxUrl);
  const rejected = expect(pendingFetch).rejects.toMatchObject({ name: "AbortError" });
  pod.dispose();
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  deliver(new Response());
  await rejected;
  await expect(options?.fetch(inboxUrl)).rejects.toMatchObject({ name: "AbortError" });
  await expect(pod.list(signal())).rejects.toMatchObject({ name: "AbortError" });
});

it.each([
  "discovery",
  "listing",
])("rejects cancellation during %s and never returns late items", async (phase) => {
  let deliver!: () => void;
  if (phase === "discovery")
    inbox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = () => resolve(inboxUrl);
        }),
    );
  else
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = () => resolve([item()]);
        }),
    );
  const pod = source();
  const request = new AbortController();
  const pending = pod.list(request.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
  request.abort();
  deliver();
  await rejected;
  if (phase === "discovery") expect(list).not.toHaveBeenCalled();
});

it("rejects a pre-aborted listing before discovery", async () => {
  const request = new AbortController();
  request.abort();
  await expect(source().list(request.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(inbox).not.toHaveBeenCalled();
});
