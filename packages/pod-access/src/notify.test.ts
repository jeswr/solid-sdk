// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import {
  assignmentAnnounce,
  createInboxReader,
  createNotify,
  mentionNotification,
  notificationKind,
  roomInvitation,
  shareNotification,
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

test("issue announcements preserve Issues' recipient target and summary as plain data", async () => {
  const { issueAnnounce } = await import("./notify.js");
  expect(
    issueAnnounce("https://pod.example/issue", "https://bob.example/#me", "Mentioned"),
  ).toEqual({
    type: "Announce",
    object: "https://pod.example/issue",
    target: "https://bob.example/#me",
    summary: "Mentioned",
  });
});

const owner = "https://8.8.8.8/profile#me";
const ownInbox = "https://8.8.8.8/inbox/";
const item = `${ownInbox}n`;
function rdf(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/turtle" } });
}
async function manager(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  inbox = ownInbox,
) {
  const { createInboxManager } = await import("./notify.js");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (input, init) =>
      String(input) === "https://8.8.8.8/profile"
        ? rdf(`<${owner}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`)
        : handler(String(input), init),
    );
  const box = await createInboxManager({ fetch, webId: owner, storageRoots: ["https://8.8.8.8/"] });
  return { box, fetch };
}

test("discovers only an owner's scoped inbox; missing, foreign and query inboxes have no manager", async () => {
  const { createInboxManager } = await import("./notify.js");
  expect(
    await createInboxManager({
      webId: owner,
      storageRoots: ["https://8.8.8.8/"],
      fetch: async () => rdf(""),
    }),
  ).toBeNull();
  for (const inbox of ["https://1.1.1.1/inbox/", `${ownInbox}?query`, "https://8.8.8.8/a%2fb/"]) {
    const { box, fetch } = await manager(() => {
      throw new Error("Must not fetch inbox");
    }, inbox);
    expect(box).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

test("reads marker existence from the listing, filters sidecars, and retains unread notifications", async () => {
  const { box } = await manager((url) => {
    if (url === ownInbox)
      return rdf(
        `<${ownInbox}> <http://www.w3.org/ns/ldp#contains> <${item}>, <${item}.read.ttl>, <${ownInbox}unread>.`,
      );
    return rdf("<#it> a <https://www.w3.org/ns/activitystreams#Announce>.");
  });
  expect.assert(box);
  expect(await box.list()).toEqual([
    { url: item, type: "Announce", read: true },
    { url: `${ownInbox}unread`, type: "Announce", read: false },
  ]);
});

test.each([
  "https://1.1.1.1/inbox/n",
  "https://8.8.8.8/outside",
  ownInbox,
  `${ownInbox}nested/n`,
  `${item}?query`,
  `${item}#fragment`,
  `${ownInbox}a%2fb`,
  `${ownInbox}a%5cb`,
  "https://user:pass@8.8.8.8/inbox/n",
  `${item}.read.ttl`,
])("refuses mark-read and dismiss outside the notification scope: %s", async (url) => {
  const { box, fetch } = await manager(() => {
    throw new Error("No I/O permitted");
  });
  await expect(box.markRead(url)).rejects.toThrow();
  await expect(box.dismiss(url)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("creates read markers conditionally, updates with If-Match, and serializes typed RDF", async () => {
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  let exists = false;
  const { box, fetch } = await manager((_url, init) => {
    if (init?.method === "HEAD")
      return new Response(null, exists ? { headers: { etag: '"marker-v1"' } } : { status: 404 });
    return new Response(null, { status: 201 });
  });
  expect.assert(box);
  await box.markRead(item);
  let init = fetch.mock.calls.at(-1)?.[1];
  expect.assert(init);
  expect(new Headers(init.headers).get("if-none-match")).toBe("*");
  expect.assert(init);
  expect(new Headers(init.headers).has("if-match")).toBe(false);
  const dataset = await parseRdf(init.body as string, "text/turtle");
  expect([...dataset].map((q) => [q.predicate.value, q.object.value])).toEqual([
    ["https://www.w3.org/ns/activitystreams#read", "true"],
    ["https://www.w3.org/ns/activitystreams#object", item],
  ]);
  exists = true;
  expect.assert(box);
  await box.markRead(item);
  init = fetch.mock.calls.at(-1)?.[1];
  expect.assert(init);
  expect(new Headers(init.headers).get("if-match")).toBe('"marker-v1"');
  expect.assert(init);
  expect(new Headers(init.headers).has("if-none-match")).toBe(false);
  expect(fetch.mock.calls.at(-1)?.[0]).toBe(`${item}.read.ttl`);
});

test.each([
  null,
  "",
  "*",
  'W/"weak"',
  '"a", "b"',
  "unquoted",
])("refuses missing or unsafe validators: %s", async (etag) => {
  const { box, fetch } = await manager(
    () => new Response(null, { headers: etag === null ? {} : { etag } }),
  );
  expect.assert(box);
  await expect(box.markRead(item)).rejects.toThrow("strong ETag");
  await expect(box.dismiss(item)).rejects.toThrow("strong ETag");
  expect(
    fetch.mock.calls.some(([, init]) => init?.method === "PUT" || init?.method === "DELETE"),
  ).toBe(false);
});

test.each([
  "PUT",
  "DELETE",
])("surfaces %s conflicts without retrying or deleting sidecars", async (method) => {
  const { box, fetch } = await manager(
    (_url, init) =>
      new Response(null, init?.method === method ? { status: 412 } : { headers: { etag: '"v1"' } }),
  );
  expect.assert(box);
  await expect(method === "PUT" ? box.markRead(item) : box.dismiss(item)).rejects.toThrow("412");
  expect(fetch.mock.calls.filter(([, init]) => init?.method === method)).toHaveLength(1);
});

test("dismiss conditionally deletes the notification and marker, tolerates absent resources and failed cleanup", async () => {
  let absent = false;
  let failedCleanup = false;
  const { box, fetch } = await manager((url, init) => {
    if (absent) return new Response(null, { status: 404 });
    if (failedCleanup && url.endsWith(".read.ttl")) throw new Error("Cleanup failed");
    return new Response(
      null,
      init?.method === "HEAD" ? { headers: { etag: '"v1"' } } : { status: 204 },
    );
  });
  expect.assert(box);
  await box.dismiss(item);
  let deletes = fetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
  expect(deletes.map(([url]) => url)).toEqual([item, `${item}.read.ttl`]);
  expect(deletes.every(([, init]) => new Headers(init?.headers).get("if-match") === '"v1"')).toBe(
    true,
  );
  absent = true;
  await expect(box.dismiss(item)).resolves.toBeUndefined();
  absent = false;
  failedCleanup = true;
  await expect(box.dismiss(item)).resolves.toBeUndefined();
  deletes = fetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
  expect(deletes).toHaveLength(3);
});

test("refuses unreadable marker/notification HEADs and never writes", async () => {
  const { box, fetch } = await manager(() => new Response(null, { status: 403 }));
  expect.assert(box);
  await expect(box.markRead(item)).rejects.toThrow("403");
  await expect(box.dismiss(item)).rejects.toThrow("403");
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "HEAD")).toBe(true);
});

test("pins the owner's storage roots and transport before async discovery", async () => {
  const { createInboxManager } = await import("./notify.js");
  let release: (response: Response) => void = () => {};
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const roots = ["https://8.8.8.8/"];
  const options = { webId: owner, fetch, storageRoots: roots };
  const pending = createInboxManager(options);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  roots.push("https://1.1.1.1/");
  options.fetch = vi.fn<typeof globalThis.fetch>();
  release(rdf(`<${owner}> <http://www.w3.org/ns/ldp#inbox> <https://1.1.1.1/inbox/>.`));
  expect(await pending).toBeNull();
  expect(options.fetch).not.toHaveBeenCalled();
});
