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
