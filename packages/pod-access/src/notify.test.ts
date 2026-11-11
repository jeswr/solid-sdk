// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import {
  assignmentAnnounce,
  createInboxReader,
  createNotify,
  issueAnnounce,
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
  const notify = createNotify({
    fetch,
    webId: "https://alice.example/profile#me",
    clock: () => Date.parse("2026-11-11T12:00:00.000Z"),
  });
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
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const ds = await parseRdf(String(fetch.mock.calls[1]?.[1]?.body), "text/turtle", {
    baseIRI: `${inbox}n`,
  });
  expect([...ds].every((q) => q.subject.value === `${inbox}n#it`)).toBe(true);
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
    issueAnnounce("https://pod.example/issue", webId, "Mentioned"),
    {
      type: "Invite" as const,
      object: "https://pod.example/poll",
      summary: "Invitation",
      content: "details",
    },
    {
      type: "Offer" as const,
      object: "https://pod.example/poll",
      summary: "RSVP yes",
      content: "https://pod.example/rsvp",
    },
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
    return new Response(bodies[Number(String(url).slice(inbox.length))], {
      headers: { "content-type": "text/turtle" },
    });
  });
  let tick = 0;
  // A strictly increasing clock makes the reader's newest-first order deterministic. The
  // reader shares it so inbox discovery is shared with the notifier.
  const clock = () => Date.UTC(2026, 10, 11) + 1_000 * tick++;
  const notify = createNotify({ fetch, clock, webId });
  for (const draft of drafts) await notify(webId, { ...draft, actor: webId });
  const reader = createInboxReader({ fetch, clock });
  expect(await reader.inbox(webId)).toBe(inbox);
  const notifications = await reader.list(inbox);
  expect(notifications.map(notificationKind)).toEqual([
    "invitation",
    "other",
    "assignment",
    "invitation",
    "mention",
    "assignment",
    "share",
  ]);
  for (const [i, draft] of drafts.entries()) {
    const item = notifications.find((item) => item.url === `${inbox}${i}`);
    expect(item).toMatchObject({ type: draft.type, actor: webId, object: draft.object });
    expect(item?.summary).toBe(draft.summary);
    if ("target" in draft) expect(item?.target).toBe(draft.target);
    if ("content" in draft) expect(item?.content).toBe(draft.content);
    expect(item?.published).toMatch(/^2026-/);
  }
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
    provenance: true,
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
  `${item}.read%2Ettl`,
  `${item}%252Eread.ttl`,
])("refuses mark-read and dismiss outside the notification scope: %s", async (url) => {
  const { box, fetch } = await manager(() => {
    throw new Error("No I/O permitted");
  });
  await expect(box.markRead(url)).rejects.toThrow();
  await expect(box.dismiss(url)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("repeated mark-read overwrites the own sidecar without HEAD or validators", async () => {
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { box, fetch } = await manager(
    () => new Response(null, { status: 201, headers: { etag: 'W/"weak"' } }),
  );
  expect.assert(box);
  await box.markRead(item);
  await box.markRead(item);
  const writes = fetch.mock.calls.slice(1);
  expect(writes).toHaveLength(2);
  for (const [url, init] of writes) {
    expect(url).toBe(`${item}.read.ttl`);
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).has("if-match")).toBe(false);
    expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
    const dataset = await parseRdf(String(init?.body), "text/turtle");
    expect([...dataset].map((q) => [q.predicate.value, q.object.value])).toEqual([
      ["https://www.w3.org/ns/activitystreams#read", "true"],
      ["https://www.w3.org/ns/activitystreams#object", item],
    ]);
  }
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

test("dismiss unconditionally deletes the notification and marker, tolerates absent resources and failed cleanup", async () => {
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
  expect(deletes.every(([, init]) => !new Headers(init?.headers).has("if-match"))).toBe(true);
  absent = true;
  await expect(box.dismiss(item)).resolves.toBeUndefined();
  absent = false;
  failedCleanup = true;
  await expect(box.dismiss(item)).resolves.toBeUndefined();
  deletes = fetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
  expect(deletes).toHaveLength(6);
});

test("surfaces forbidden marker writes and notification deletes", async () => {
  const { box, fetch } = await manager(() => new Response(null, { status: 403 }));
  expect.assert(box);
  await expect(box.markRead(item)).rejects.toThrow("403");
  await expect(box.dismiss(item)).rejects.toThrow("403");
  expect(fetch.mock.calls.slice(1).map(([, init]) => init?.method)).toEqual(["PUT", "DELETE"]);
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

test("manager reads beyond 50 notifications, ignores sidecars in its budget and sorts before display limits", async () => {
  const { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } = await import("@rdfjs/wrapper");
  const { DataFactory, Store } = await import("n3");
  const { serialize } = await import("@jeswr/rdf-serialize");
  const { createInboxManager } = await import("./notify.js");
  const dataset = new Store();
  const doc = new TermWrapper(ownInbox, dataset, DataFactory);
  const members = SetFrom.subjectPredicate(
    doc,
    "http://www.w3.org/ns/ldp#contains",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  );
  for (let i = 0; i < 60; i++) {
    members.add(`${ownInbox}${i}.read.ttl`);
    members.add(`${ownInbox}${i}`);
  }
  const listing = await serialize([...dataset]);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith("/profile"))
      return rdf(
        "<https://8.8.8.8/profile#me> <http://www.w3.org/ns/ldp#inbox> <https://8.8.8.8/inbox/>.",
      );
    if (url === ownInbox) return rdf(listing);
    const child = new TermWrapper(`${url}#it`, new Store(), DataFactory);
    const { OptionalAs, LiteralFrom } = await import("@rdfjs/wrapper");
    OptionalAs.object(
      child,
      "https://www.w3.org/ns/activitystreams#summary",
      String(url),
      LiteralFrom.string,
    );
    OptionalAs.object(
      child,
      "https://www.w3.org/ns/activitystreams#published",
      new Date(Date.UTC(2026, 0, 1) + Number(String(url).slice(ownInbox.length)) * 1000),
      LiteralFrom.dateTime,
    );
    return rdf(await serialize([...child.dataset]));
  });
  const full = await createInboxManager({
    fetch,
    webId: owner,
    storageRoots: ["https://8.8.8.8/"],
  });
  expect.assert(full);
  const page = await full.listPage();
  expect(page.notifications).toHaveLength(60);
  expect(page.notifications[0].url).toBe(`${ownInbox}59`);
  expect(page.notifications.every((item) => item.read)).toBe(true);
  expect(page.truncated).toBe(false);
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith(".read.ttl"))).toBe(false);
  const limited = await createInboxManager({
    fetch,
    webId: owner,
    storageRoots: ["https://8.8.8.8/"],
    maxItems: 2,
  });
  expect.assert(limited);
  expect((await limited.listPage()).notifications.map((item) => item.url)).toEqual([
    `${ownInbox}59`,
    `${ownInbox}58`,
  ]);
  expect((await limited.listPage()).truncated).toBe(true);
});

test.each([
  -1,
  501,
  1.5,
  Number.NaN,
])("manager rejects invalid display maxItems=%s before I/O", async (maxItems) => {
  const { createInboxManager } = await import("./notify.js");
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(
    createInboxManager({ fetch, webId: owner, storageRoots: ["https://8.8.8.8/"], maxItems }),
  ).rejects.toThrow(TypeError);
  expect(fetch).not.toHaveBeenCalled();
});
