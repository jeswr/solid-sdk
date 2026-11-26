// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { expect, test, vi } from "vitest";
import {
  assignmentAnnounce,
  createInboxReader,
  createNotify,
  type InboxNotification,
  mentionNotification,
  notificationKind,
  readInvitations,
  roomInvitation,
  shareNotification,
  withAbortSignal,
} from "./notify.js";

test("builds the four notification templates without inventing an actor or changing access", () => {
  expect(shareNotification("https://pod.example/doc", "editor")).toEqual({
    type: "Announce",
    object: "https://pod.example/doc",
    summary: "Shared with you as editor",
  });
  expect(
    assignmentAnnounce(
      "https://pod.example/task#it",
      "https://pod.example/tracker#this",
      "Alice",
      "Pay rent",
    ),
  ).toEqual({
    type: "Announce",
    object: "https://pod.example/task#it",
    target: "https://pod.example/tracker#this",
    summary: "Alice assigned you 'Pay rent'",
  });
  expect(mentionNotification("https://pod.example/comment#it", "https://pod.example/doc")).toEqual({
    type: "Create",
    object: "https://pod.example/comment#it",
    target: "https://pod.example/doc",
  });
  expect(roomInvitation("https://pod.example/room/")).toEqual({
    type: "Offer",
    object: "https://pod.example/room/",
  });
});

test("wraps the real sender and delivers the byte-stable assignment with the caller fetch", async () => {
  const webId = "https://8.8.8.8/profile#me";
  const inbox = "https://8.8.4.4/inbox/";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
        headers: { "content-type": "text/turtle" },
      }),
    )
    .mockResolvedValue(new Response(null, { status: 201 }));
  const notify = createNotify({ fetch, clock: () => Date.parse("2026-11-11T12:00:00.000Z") });
  await expect(
    notify(webId, {
      ...assignmentAnnounce(
        "https://pod.example/task#it",
        "https://pod.example/tracker#this",
        "Alice",
        "Pay rent",
      ),
      actor: "https://alice.example/profile#me",
    }),
  ).resolves.toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[0]).toBe(inbox);
  expect(fetch.mock.calls[1]?.[1]?.body).toMatchInlineSnapshot(
    `"{"@context":"https://www.w3.org/ns/activitystreams","type":"Announce","actor":"https://alice.example/profile#me","object":"https://pod.example/task#it","target":"https://pod.example/tracker#this","summary":"Alice assigned you 'Pay rent'","published":"2026-11-11T12:00:00.000Z"}"`,
  );
});

test("wraps inbox discovery and reading, and classifies each real builder round-trip", async () => {
  const webId = "https://8.8.8.8/profile#me";
  const inbox = "https://8.8.4.4/inbox/";
  const drafts = [
    shareNotification("https://pod.example/doc", "editor"),
    assignmentAnnounce(
      "https://pod.example/task",
      "https://pod.example/tracker",
      "Alice",
      "Pay rent",
    ),
    mentionNotification("https://pod.example/comment", "https://pod.example/doc"),
    roomInvitation("https://pod.example/room/"),
  ];
  const bodies: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      bodies.push(init.body as string);
      return new Response(null, { status: 201 });
    }
    if (url === "https://8.8.8.8/profile") {
      return new Response(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
        headers: { "content-type": "text/turtle" },
      });
    }
    if (url === inbox) {
      return new Response(
        `<${inbox}> <http://www.w3.org/ns/ldp#contains> ${drafts.map((_, i) => `<${inbox}${i}`).join(">, ")}>.`,
        { headers: { "content-type": "text/turtle" } },
      );
    }
    // Model the pod's RDF representation: a stored subject and a local AS context.
    const activity = JSON.parse(bodies[Number(String(url).slice(inbox.length))] as string);
    return new Response(
      JSON.stringify({
        ...activity,
        "@id": `${url}#it`,
        "@context": {
          "@vocab": "https://www.w3.org/ns/activitystreams#",
          type: "@type",
          actor: { "@type": "@id" },
          object: { "@type": "@id" },
          target: { "@type": "@id" },
          published: { "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
        },
      }),
      {
        headers: { "content-type": "application/ld+json" },
      },
    );
  });
  let tick = 0;
  // A strictly increasing clock makes the reader's newest-first order deterministic. The
  // reader shares it so inbox discovery is shared with the notifier.
  const clock = () => Date.UTC(2026, 10, 11) + 1_000 * tick++;
  const notify = createNotify({ fetch, clock });
  for (const draft of drafts) await notify(webId, { ...draft, actor: webId });
  const reader = createInboxReader({ fetch, clock });
  expect(await reader.inbox(webId)).toBe(inbox);
  const notifications = await reader.list(inbox);
  expect(notifications.map(notificationKind)).toEqual([
    "invitation",
    "mention",
    "assignment",
    "share",
  ]);
  expect(fetch.mock.calls.filter(([url]) => url === "https://8.8.8.8/profile")).toHaveLength(1);
});

test("classifies unfamiliar activities conservatively and prioritizes share summaries", () => {
  for (const notification of [
    { type: "Announce" },
    { type: "Announce", summary: "Something else" },
    { type: "Create" },
    { type: "Accept", target: "https://pod.example/" },
  ])
    expect(notificationKind({ url: "https://pod.example/inbox/n", ...notification })).toBe("other");
  expect(
    notificationKind({
      url: "https://pod.example/inbox/n",
      ...shareNotification("https://pod.example/doc", "reader"),
      target: "https://pod.example/",
    }),
  ).toBe("share");
});

test("projects the newest distinct resources of one kind, excludes accepted/malformed items and caps", async () => {
  const reader = {
    inbox: vi.fn().mockResolvedValue("https://pod.example/inbox/"),
    list: vi.fn().mockResolvedValue([
      { url: "other", type: "Create" },
      { url: "missing", type: "Offer" },
      { url: "bad", type: "Offer", object: "throw" },
      { url: "empty", type: "Offer", object: "" },
      { url: "accepted", type: "Offer", object: "joined" },
      { url: "new", type: "Offer", object: "one" },
      { url: "old", type: "Offer", object: "one" },
      { url: "two", type: "Offer", object: "two" },
      { url: "three", type: "Offer", object: "three" },
    ]),
  };
  const normalise = (item: InboxNotification) => {
    if (item.url === "missing") return null;
    if (item.object === "throw") throw new Error("Malformed");
    return { key: item.object as string, value: item.url };
  };
  expect(
    await readInvitations({
      reader,
      webId: "me",
      kind: "invitation",
      normalise,
      exclude: new Set(["joined"]),
      limit: 2,
    }),
  ).toEqual(["new", "two"]);
  expect(
    await readInvitations({
      reader,
      webId: "me",
      normalise: (item) => ({ key: item.url, value: item.url }),
    }),
  ).toHaveLength(9);
  reader.list.mockResolvedValue([]);
  expect(await readInvitations({ reader, webId: "me", normalise })).toEqual([]);
  reader.inbox.mockResolvedValue(null);
  expect(await readInvitations({ reader, webId: "me", normalise })).toEqual([]);
});

test("validates limits before I/O and preserves discovery/listing errors", async () => {
  const reader = { inbox: vi.fn(), list: vi.fn() };
  const normalise = () => null;
  for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await expect(readInvitations({ reader, webId: "me", normalise, limit })).rejects.toThrow(
      "Invalid invitation limit",
    );
  expect(await readInvitations({ reader, webId: "me", normalise, limit: 0 })).toEqual([]);
  expect(reader.inbox).not.toHaveBeenCalled();
  reader.inbox.mockRejectedValueOnce(new Error("Discovery failed"));
  await expect(readInvitations({ reader, webId: "me", normalise })).rejects.toThrow(
    "Discovery failed",
  );
  reader.inbox.mockResolvedValue("https://pod.example/inbox/");
  reader.list.mockRejectedValueOnce(new Error("Listing failed"));
  await expect(readInvitations({ reader, webId: "me", normalise })).rejects.toThrow(
    "Listing failed",
  );
});

test("with the real reader, discovery failures read as no inbox and listing 5xx propagates", async () => {
  const webId = "https://8.8.8.8/profile#me";
  const inbox = "https://8.8.4.4/inbox/";
  const normalise = (item: InboxNotification) => ({ key: item.url, value: item.url });
  const profile = new Response(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
    headers: { "content-type": "text/turtle" },
  });
  // Each reader gets its own transport, so the discovery cache never crosses cases.
  for (const failure of [
    () => new Response(null, { status: 503 }),
    () => new Response(null, { status: 403 }),
    () => {
      throw new TypeError("Network down");
    },
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => failure());
    const reader = createInboxReader({ fetch });
    expect(await readInvitations({ reader, webId, normalise })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    url === inbox ? new Response(null, { status: 503 }) : profile.clone(),
  );
  await expect(
    readInvitations({ reader: createInboxReader({ fetch }), webId, normalise }),
  ).rejects.toMatchObject({ status: 503 });
});

test.each([
  "before",
  "discovery",
  "listing",
  "normalise",
  "malformed",
  "iteration",
])("rejects abort at %s even when reader ignores cancellation", async (phase) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const item = { url: "one", type: "Offer" };
  const reader = {
    inbox: vi.fn(async () => {
      if (phase === "discovery") abort();
      return "https://pod.example/inbox/";
    }),
    list: vi.fn(async () => {
      if (phase === "listing") abort();
      return [item, { url: "two", type: "Offer" }];
    }),
  };
  if (phase === "before") abort();
  if (phase === "iteration")
    Object.defineProperty(item, "type", {
      get() {
        abort();
        return "Create";
      },
    });
  const normalise = () => {
    if (phase === "normalise" || phase === "malformed") abort();
    if (phase === "malformed") throw new Error("Invalid item");
    return { key: "one", value: "one" };
  };
  await expect(
    readInvitations({
      reader,
      webId: "me",
      kind: "invitation",
      normalise,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  if (phase === "before") expect(reader.inbox).not.toHaveBeenCalled();
  if (phase === "discovery") expect(reader.list).not.toHaveBeenCalled();
});

test("combines request deadlines with fixed/dynamic lifetimes and fences late fetches", async () => {
  const lifetime = new AbortController();
  const deadline = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response());
  await withAbortSignal(fetch, lifetime.signal)("https://pod.example/");
  expect(fetch.mock.calls[0]?.[1]?.signal).toBe(lifetime.signal);
  const scoped = withAbortSignal(fetch, () => lifetime.signal);
  await scoped("https://pod.example/", { method: "GET", signal: deadline.signal });
  const combined = fetch.mock.calls[1]?.[1]?.signal;
  deadline.abort();
  expect(combined?.aborted).toBe(true);
  await expect(scoped("https://pod.example/", { signal: deadline.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  fetch.mockImplementationOnce(async () => {
    lifetime.abort();
    return new Response();
  });
  await expect(scoped("https://pod.example/")).rejects.toMatchObject({ name: "AbortError" });
  await expect(scoped("https://pod.example/")).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(3);
});
