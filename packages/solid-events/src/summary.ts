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
  /** Trusted transport metadata; never populate this from reply RDF or a generic header. */
  verifiedAgent?: string;
  /** Last-Modified (or a trusted server creation timestamp), never the submitted time. */
  receivedAt?: Date;
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
  unverified: Reply[];
}

/** Only transport-proven authorship can replace and count for a WebID.
 * Unverified claims remain separate, including anonymous receipts: a public hash is not proof.
 * Server times take precedence; claims more than five minutes ahead are invalid. */
export function summariseRsvps(
  replies: readonly Reply[],
  event: Pick<EventData, "capacity" | "rsvpDeadline"> & { url: string },
  now = new Date(),
): RsvpSummary {
  const newest = new Map<string, Reply>();
  const eventSubject = entities.Event.subject(eventDocumentUrl(event.url));
  let invalid = 0;
  const unverified: Reply[] = [];
  const time = (reply: Reply) => +(reply.receivedAt ?? reply.repliedAt);
  for (const reply of replies) {
    try {
      validateRsvp(reply);
    } catch {
      invalid++;
      continue;
    }
    if (
      reply.event !== eventSubject ||
      +reply.repliedAt > +now + 5 * 60 * 1000 ||
      !Number.isFinite(time(reply)) ||
      time(reply) > +now + 5 * 60 * 1000
    ) {
      invalid++;
      continue;
    }
    if (!reply.agent || reply.verifiedAgent !== reply.agent) {
      unverified.push(reply);
      continue;
    }
    const key = reply.agent;
    const old = newest.get(key);
    if (!old || time(reply) > time(old) || (time(reply) === time(old) && reply.url > old.url))
      newest.set(key, reply);
  }
  const latest = [...newest.values()].sort(
    (a, b) => time(b) - time(a) || a.url.localeCompare(b.url),
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
      ? [...latest, ...unverified].filter((r) => time(r) > +(event.rsvpDeadline as Date))
      : [],
    latest,
    invalid,
    unverified: unverified.sort((a, b) => time(b) - time(a) || a.url.localeCompare(b.url)),
  };
}
