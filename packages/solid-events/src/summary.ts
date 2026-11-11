// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type EventData,
  entities,
  eventDocumentUrl,
  RSVP_RESPONSE,
  type RsvpData,
  validateRsvp,
} from "./model.js";

export interface Reply extends RsvpData {
  url: string;
}
export interface RsvpSummary {
  yes: number;
  no: number;
  maybe: number;
  additionalGuests: number;
  attending: number;
  remaining: number | null;
  overCapacity: number;
  late: Reply[];
  latest: Reply[];
  invalid: number;
}

/** Replies are self-reported claims, including their agent and timestamp, not identity proofs.
 * Anonymous identity uses a random per-event guest key, never a display name.
 * Equal timestamps break ties by resource URL so listing order cannot change a tally. */
export function summariseRsvps(
  replies: readonly Reply[],
  event: Pick<EventData, "capacity" | "rsvpDeadline"> & { url: string },
): RsvpSummary {
  const newest = new Map<string, Reply>();
  const eventSubject = entities.Event.subject(eventDocumentUrl(event.url));
  let invalid = 0;
  for (const reply of replies) {
    try {
      validateRsvp(reply);
    } catch {
      invalid++;
      continue;
    }
    if (reply.event !== eventSubject) {
      invalid++;
      continue;
    }
    const key = reply.agent ? `webid:${reply.agent}` : `guest:${reply.guestKey}`;
    const old = newest.get(key);
    if (
      !old ||
      reply.repliedAt > old.repliedAt ||
      (+reply.repliedAt === +old.repliedAt && reply.url > old.url)
    )
      newest.set(key, reply);
  }
  const latest = [...newest.values()].sort(
    (a, b) => +b.repliedAt - +a.repliedAt || a.url.localeCompare(b.url),
  );
  const yes = latest.filter((r) => r.response === RSVP_RESPONSE.yes);
  const additionalGuests = yes.reduce((sum, r) => sum + r.additionalGuests, 0);
  const attending = yes.length + additionalGuests;
  return {
    yes: yes.length,
    no: latest.filter((r) => r.response === RSVP_RESPONSE.no).length,
    maybe: latest.filter((r) => r.response === RSVP_RESPONSE.maybe).length,
    additionalGuests,
    attending,
    remaining: event.capacity === undefined ? null : Math.max(0, event.capacity - attending),
    overCapacity: event.capacity === undefined ? 0 : Math.max(0, attending - event.capacity),
    late: event.rsvpDeadline
      ? latest.filter((r) => r.repliedAt > (event.rsvpDeadline as Date))
      : [],
    latest,
    invalid,
  };
}
