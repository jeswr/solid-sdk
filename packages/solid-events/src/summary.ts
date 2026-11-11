// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
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
export interface RsvpTally {
  yes: number;
  no: number;
  maybe: number;
  additionalGuests: number;
  attending: number;
}
export interface RsvpSummary extends RsvpTally {
  remaining: number | null;
  overCapacity: number;
  late: Reply[];
  latest: Reply[];
  invalid: number;
  unverified: Reply[];
  unverifiedTally: RsvpTally;
  earlierReplies: Reply[];
}

/** Only transport-proven authorship can replace and count for a WebID.
 * Group unverified revisions separately by claimed WebID/receipt hash, which is not proof.
 * Server times take precedence; the effective time must not be five minutes ahead. */
export function summariseRsvps(
  replies: readonly Reply[],
  event: Pick<EventData, "capacity" | "rsvpDeadline"> & { url: string },
  now = new Date(),
): RsvpSummary {
  const newest = new Map<string, Reply>();
  const eventSubject = entities.Event.subject(eventDocumentUrl(event.url));
  let invalid = 0;
  const claims = new Map<string, Reply>();
  const earlierReplies: Reply[] = [];
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
      !Number.isFinite(time(reply)) ||
      time(reply) > +now + 5 * 60 * 1000
    ) {
      invalid++;
      continue;
    }
    const verified = reply.agent && reply.verifiedAgent === reply.agent;
    const group = verified ? newest : claims;
    const key = reply.agent ? `agent:${reply.agent}` : `guest:${reply.guestKey}`;
    const old = group.get(key);
    if (!old || time(reply) > time(old) || (time(reply) === time(old) && reply.url > old.url)) {
      group.set(key, reply);
      if (old && !verified) earlierReplies.push(old);
    } else if (!verified) earlierReplies.push(reply);
  }
  const latest = [...newest.values()].sort(
    (a, b) => time(b) - time(a) || a.url.localeCompare(b.url),
  );
  const unverified = [...claims.values()].sort(
    (a, b) => time(b) - time(a) || a.url.localeCompare(b.url),
  );
  const tally = (rows: Reply[]): RsvpTally => {
    const yes = rows.filter((r) => r.response === RSVP_RESPONSE.yes);
    const additionalGuests = yes.reduce((sum, r) => sum + r.additionalGuests, 0);
    return {
      yes: yes.length,
      no: rows.filter((r) => r.response === RSVP_RESPONSE.no).length,
      maybe: rows.filter((r) => r.response === RSVP_RESPONSE.maybe).length,
      additionalGuests,
      attending: yes.length + additionalGuests,
    };
  };
  const verifiedTally = tally(latest);
  const unverifiedTally = tally(unverified);
  const attending = verifiedTally.attending + unverifiedTally.attending;
  return {
    ...verifiedTally,
    unverifiedTally,
    earlierReplies: earlierReplies.sort((a, b) => time(b) - time(a) || a.url.localeCompare(b.url)),
    remaining: event.capacity === undefined ? null : Math.max(0, event.capacity - attending),
    overCapacity: event.capacity === undefined ? 0 : Math.max(0, attending - event.capacity),
    late: event.rsvpDeadline
      ? [...latest, ...unverified].filter((r) => time(r) > +(event.rsvpDeadline as Date))
      : [],
    latest,
    invalid,
    unverified,
  };
}
