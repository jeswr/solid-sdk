// AUTHORED-BY Codex (GPT-6.1 Sol)

import { parseRdf } from "@jeswr/fetch-rdf";
import { readWac } from "@jeswr/pod-access";
import {
  appendRsvp,
  createEventsRepository,
  EVENT_STATUS,
  type EventData,
  entities,
  RSVP_RESPONSE,
  readInvitation,
  readReplies,
  summariseRsvps,
} from "@jeswr/solid-events";
import { expect, it, vi } from "vitest";
import { ensureEventsSample } from "../../src/apps/events/demo/sample";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import type { PodSession } from "../../src/lib/session/pod-session";

const ROOT = "https://events.demo.pod/";
const OWNER = `${ROOT}profile/card#me`;
function fixture() {
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: `<${OWNER}> <http://www.w3.org/ns/pim/space#storage> <${ROOT}> .`,
      },
    ],
  });
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    displayName: "Marlowe Finch",
    storageUrl: ROOT,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return {
    pod,
    session,
    repository: createEventsRepository({
      fetch: pod.fetch,
      storageRoot: ROOT,
      owner: OWNER,
      demo: true,
    }),
  };
}
const draft = (patch: Partial<EventData> = {}): EventData => ({
  name: "Lantern supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: OWNER,
  eventStatus: EVENT_STATUS.scheduled,
  visibility: "link",
  guestListVisible: false,
  publication: "published",
  created: new Date(),
  modified: new Date(),
  ...patch,
});
it("creates invitation containers, registers Event, grants Append without guest Read, and conditionally edits", async () => {
  const { pod, repository } = fixture();
  expect(await repository.list()).toEqual([]);
  const event = await repository.create(draft(), [], "supper");
  expect(event.url).toBe(`${ROOT}events/supper/index.ttl`);
  expect((await repository.list()).map((e) => e.name)).toEqual(["Lantern supper"]);
  const replyContainer = new URL("rsvps/", event.url).href;
  const aclUrl = `${replyContainer}.acl`;
  const policy = readWac(
    await parseRdf(await (await pod.fetch(aclUrl)).text(), "text/turtle"),
    replyContainer,
    aclUrl,
  );
  const publicGrants = policy.grants.filter((g) =>
    g.who.some((c) => c.some((s) => s.kind === "public")),
  );
  expect(publicGrants).toHaveLength(1);
  expect([...(publicGrants[0]?.modes ?? [])]).toEqual(["append"]);
  expect(publicGrants[0]?.appliesTo).toBe("resource");
  const updated = await repository.update(event, { ...event, name: "Lantern supper, revised" });
  expect(updated.name).toBe("Lantern supper, revised");
  await expect(repository.update(event, { ...event, name: "Stale edit" })).rejects.toMatchObject({
    code: "precondition-failed",
  });
  await expect(repository.update(updated, { ...updated, guestListVisible: true })).rejects.toThrow(
    "Sharing settings",
  );
  expect(
    pod
      .snapshot()
      .resources.some(([, r]) =>
        new TextDecoder().decode(r.body).includes("https://schema.org/Event"),
      ),
  ).toBe(true);
});
it("round-trips replies, changes and visible guest-list access", async () => {
  const { pod, repository } = fixture();
  const event = await repository.create(draft({ guestListVisible: true }), [], "visible");
  const first = await appendRsvp(
    pod.fetch,
    event,
    {
      event: entities.Event.subject(event.url),
      displayName: "Tavi Moss",
      guestKey: "tavi",
      response: RSVP_RESPONSE.yes,
      additionalGuests: 2,
      repliedAt: new Date(Date.now() - 1000),
    },
    "one",
  );
  await appendRsvp(
    pod.fetch,
    event,
    { ...first, response: RSVP_RESPONSE.maybe, repliedAt: new Date() },
    "two",
  );
  const replies = await readReplies(pod.fetch, event.url);
  expect(replies.replies).toHaveLength(2);
  expect(summariseRsvps(replies.replies, { url: entities.Event.subject(event.url) })).toMatchObject(
    {
      yes: 0,
      maybe: 0,
      attending: 0,
      invalid: 0,
      unverified: expect.arrayContaining([expect.objectContaining({ displayName: "Tavi Moss" })]),
    },
  );
  const container = new URL("rsvps/", event.url).href;
  const acl = `${container}.acl`;
  const policy = readWac(
    await parseRdf(await (await pod.fetch(acl)).text(), "text/turtle"),
    container,
    acl,
  );
  expect(
    policy.grants.some(
      (g) =>
        g.who.some((c) => c.some((s) => s.kind === "public")) &&
        g.modes.has("read") &&
        g.appliesTo === "both",
    ),
  ).toBe(true);
  expect(await readInvitation(pod.fetch, `${event.url}#it`)).toMatchObject({ name: event.name });
});
it("keeps drafts private, persists invited WebIDs and refuses anonymous replies to private invitations", async () => {
  const { pod, repository } = fixture();
  const webId = "https://cleo.example/profile#me";
  const event = await repository.create(
    draft({ publication: "draft", visibility: "invitees" }),
    [{ webId, event: "https://pending.example/e#it", invitedAt: new Date() }],
    "private",
  );
  expect(await repository.invitees(event)).toMatchObject([
    { webId, event: entities.Event.subject(event.url) },
  ]);
  const reply = {
    event: entities.Event.subject(event.url),
    displayName: "Tavi",
    guestKey: "tavi",
    response: RSVP_RESPONSE.yes,
    additionalGuests: 0,
    repliedAt: new Date(),
  };
  await expect(appendRsvp(pod.fetch, event, reply)).rejects.toThrow("accepting");
  await expect(
    appendRsvp(pod.fetch, { ...event, publication: "published" }, reply),
  ).rejects.toThrow("Sign in");
});
it("seeds demo once, leaves other sessions untouched and covers every collection", async () => {
  const { session, repository } = fixture();
  await Promise.all([ensureEventsSample(session), ensureEventsSample(session)]);
  const events = await repository.list();
  expect(events).toHaveLength(5);
  expect(events.filter((e) => e.publication === "draft")).toHaveLength(1);
  expect(events.filter((e) => e.eventStatus === EVENT_STATUS.cancelled)).toHaveLength(1);
  expect(
    (
      await readReplies(
        session.fetch,
        events.find((e) => e.name === "A little supper club")?.url ?? "missing",
      )
    ).replies,
  ).toHaveLength(4);
  const fetch = vi.fn();
  await ensureEventsSample({ ...session, mode: "solid", publicFetch: fetch, fetch });
  expect(fetch).not.toHaveBeenCalled();
});
