// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import {
  assignmentAnnounce,
  createNotify,
  mentionNotification,
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
  const notify = createNotify({ fetch });
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
    `"{"@context":"https://www.w3.org/ns/activitystreams","type":"Announce","actor":"https://alice.example/profile#me","object":"https://pod.example/task#it","target":"https://pod.example/tracker#this","summary":"Alice assigned you 'Pay rent'"}"`,
  );
});
