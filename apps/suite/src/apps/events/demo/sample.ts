// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  appendRsvp,
  createEventsRepository,
  EVENT_STATUS,
  entities,
  RSVP_RESPONSE,
} from "@jeswr/solid-events";
import type { PodSession } from "@/lib/session/pod-session";

const seeds = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function ensureEventsSample(session: PodSession, now = new Date()): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const previous = seeds.get(session.fetch);
  if (previous) return previous;
  const pending = seed(session, now).catch((error) => {
    seeds.delete(session.fetch);
    throw error;
  });
  seeds.set(session.fetch, pending);
  return pending;
}
async function seed(session: PodSession, now: Date) {
  const repository = createEventsRepository({
    fetch: session.fetch,
    storageRoot: session.storageUrl,
    owner: session.webId,
    demo: true,
  });
  if ((await repository.list()).length) return;
  const titles = [
    "A little supper club",
    "Sunday by the river",
    "Winter lantern workshop",
    "The autumn picnic",
    "Board games & good company",
  ];
  for (const [index, name] of titles.entries()) {
    const startDate = new Date(+now + ([5, 10, 21, -14, 18][index] ?? 5) * 86400000);
    startDate.setHours(18, 30, 0, 0);
    const event = await repository.create(
      {
        name,
        description:
          index === 0
            ? "An evening of shared dishes, tall stories and something sweet. Bring a favourite dish if you like — there is always room at our table."
            : "A fictional invitation to make a little time for good company.",
        startDate,
        endDate: new Date(+startDate + 3 * 3600000),
        location:
          [
            "The Glasshouse kitchen",
            "Willowbank meadow",
            "The Paper Moon studio",
            "Fernwood gardens",
            "The cosy corner",
          ][index] ?? "The kitchen",
        address: "12 Lantern Lane · Sample town",
        organizer: session.webId,
        eventStatus: index === 4 ? EVENT_STATUS.cancelled : EVENT_STATUS.scheduled,
        capacity: 12 + index * 4,
        visibility: "link",
        guestListVisible: index !== 1,
        publication: index === 2 ? "draft" : "published",
        created: now,
        modified: now,
        rsvpDeadline: new Date(+startDate - 86400000),
      },
      [],
      `sample-${index}`,
    );
    if (event.publication !== "published" || event.eventStatus !== EVENT_STATUS.scheduled) continue;
    for (const [guest, displayName] of [
      "Marlowe Finch",
      "Tavi Moss",
      "Cleo Wren",
      "Indigo Vale",
    ].entries()) {
      await appendRsvp(
        session.fetch,
        event,
        {
          event: entities.Event.subject(event.url),
          displayName,
          guestKey: `sample-${guest}`,
          response:
            [RSVP_RESPONSE.yes, RSVP_RESPONSE.yes, RSVP_RESPONSE.maybe, RSVP_RESPONSE.no][guest] ??
            RSVP_RESPONSE.yes,
          additionalGuests: guest === 0 ? 1 : 0,
          repliedAt: new Date(+now - guest * 3600000),
          comment: guest === 0 ? "I'll bring something for pudding!" : "",
        },
        `sample-${guest}`,
      );
    }
  }
}
