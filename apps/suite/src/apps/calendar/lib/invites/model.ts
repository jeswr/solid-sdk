// AUTHORED-BY Codex GPT-6.1-Sol

export const participationStatuses = [
  "NEEDS-ACTION",
  "ACCEPTED",
  "DECLINED",
  "TENTATIVE",
  "DELEGATED",
] as const;
export type ParticipationStatus = (typeof participationStatuses)[number];
export const attendeeRoles = [
  "CHAIR",
  "REQ-PARTICIPANT",
  "OPT-PARTICIPANT",
  "NON-PARTICIPANT",
] as const;
export type AttendeeRole = (typeof attendeeRoles)[number];
export type InvitationErrorCode =
  | "invalid-input"
  | "invalid-identity"
  | "invalid-sequence"
  | "invalid-timestamp"
  | "forbidden"
  | "cancelled"
  | "event-mismatch"
  | "future-reply";

/** Messages contain codes only, never attendee or event input. */
export class InvitationError extends Error {
  constructor(public readonly code: InvitationErrorCode) {
    super(`Calendar invitations: ${code}`);
    this.name = "InvitationError";
  }
}

export interface AttendeeSpec {
  readonly webId: string;
  readonly role: AttendeeRole;
}
export interface Attendee extends AttendeeSpec {
  readonly status: ParticipationStatus;
  /** Latest reply DTSTAMP at this SEQUENCE, or null before any reply. */
  readonly repliedAt: string | null;
}
export interface Invitation {
  readonly uid: string;
  readonly organizer: string;
  readonly sequence: number;
  readonly cancelled: boolean;
  readonly attendees: readonly Attendee[];
}
interface MessageBase {
  readonly uid: string;
  readonly organizer: string;
  readonly sequence: number;
  /** Explicit, second-precision ISO UTC DTSTAMP; no clock access. */
  readonly dtstamp: string;
}
export interface RequestPlan extends MessageBase {
  readonly method: "REQUEST";
  readonly from: string;
  readonly to: readonly string[];
  readonly attendees: readonly Attendee[];
}
export interface ReplyPlan extends MessageBase {
  readonly method: "REPLY";
  readonly from: string;
  readonly to: string;
  readonly status: ParticipationStatus;
}
export interface CancelPlan extends MessageBase {
  readonly method: "CANCEL";
  readonly from: string;
  readonly to: readonly string[];
}
export type InvitationMessagePlan = RequestPlan | ReplyPlan | CancelPlan;
export interface InvitationChange {
  readonly state: Invitation;
  readonly messages: readonly InvitationMessagePlan[];
}

function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new InvitationError("invalid-input");
  }
}

function text(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsafe control input.
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new InvitationError("invalid-input");
  }
}

function identity(value: unknown): asserts value is string {
  text(value);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvitationError("invalid-identity");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href !== value
  ) {
    throw new InvitationError("invalid-identity");
  }
}

function sequence(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2_147_483_647) {
    throw new InvitationError("invalid-sequence");
  }
}

function timestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
    value < "0001" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value.replace("Z", ".000Z")
  ) {
    throw new InvitationError("invalid-timestamp");
  }
}

function status(value: unknown): asserts value is ParticipationStatus {
  if (!participationStatuses.includes(value as ParticipationStatus)) {
    throw new InvitationError("invalid-input");
  }
}

function attendees(value: unknown, withStatus: boolean): Attendee[] {
  if (!Array.isArray(value)) throw new InvitationError("invalid-input");
  const seen = new Set<string>();
  return Array.from(value, (entry) => {
    shape(entry, withStatus ? ["webId", "role", "status", "repliedAt"] : ["webId", "role"]);
    identity(entry.webId);
    if (seen.has(entry.webId) || !attendeeRoles.includes(entry.role as AttendeeRole)) {
      throw new InvitationError("invalid-input");
    }
    seen.add(entry.webId);
    let participation: ParticipationStatus = "NEEDS-ACTION";
    let repliedAt: string | null = null;
    if (withStatus) {
      status(entry.status);
      participation = entry.status;
      if (entry.repliedAt !== null) timestamp(entry.repliedAt);
      repliedAt = entry.repliedAt;
    }
    return {
      webId: entry.webId,
      role: entry.role as AttendeeRole,
      status: participation,
      repliedAt,
    };
  });
}

/** Validates persisted data as well as caller-created state. No coercion or unknown fields. */
function invitation(value: Invitation): Invitation {
  shape(value, ["uid", "organizer", "sequence", "cancelled", "attendees"]);
  text(value.uid);
  identity(value.organizer);
  sequence(value.sequence);
  if (typeof value.cancelled !== "boolean") throw new InvitationError("invalid-input");
  return { ...value, attendees: attendees(value.attendees, true) };
}

function active(state: Invitation): void {
  if (state.cancelled) throw new InvitationError("cancelled");
}

function organizerOnly(state: Invitation, actor: string): void {
  identity(actor);
  if (actor !== state.organizer) throw new InvitationError("forbidden");
  active(state);
}

function base(state: Invitation, dtstamp: string): MessageBase {
  timestamp(dtstamp);
  return { uid: state.uid, organizer: state.organizer, sequence: state.sequence, dtstamp };
}

function nextSequence(state: Invitation): number {
  const next = state.sequence + 1;
  sequence(next);
  return next;
}

/** New attendees always start at NEEDS-ACTION, with an initial SEQUENCE of zero. */
export function createInvitation(input: {
  readonly uid: string;
  readonly organizer: string;
  readonly attendees: readonly AttendeeSpec[];
}): Invitation {
  shape(input, ["uid", "organizer", "attendees"]);
  text(input.uid);
  identity(input.organizer);
  return {
    uid: input.uid,
    organizer: input.organizer,
    sequence: 0,
    cancelled: false,
    attendees: attendees(input.attendees, false),
  };
}

/** Plan an initial invitation or retransmit the current revision without advancing SEQUENCE. */
export function planInvite(input: Invitation, actor: string, dtstamp: string): RequestPlan {
  const state = invitation(input);
  organizerOnly(state, actor);
  return {
    ...base(state, dtstamp),
    method: "REQUEST",
    from: state.organizer,
    to: state.attendees.map((attendee) => attendee.webId),
    attendees: state.attendees,
  };
}

/** Only membership and roles are accepted; an organizer cannot overwrite other people's RSVP. */
export function setAttendees(
  input: Invitation,
  actor: string,
  members: readonly AttendeeSpec[],
  dtstamp: string,
): InvitationChange {
  const previous = invitation(input);
  organizerOnly(previous, actor);
  const next = attendees(members, false);
  const old = new Map(previous.attendees.map((attendee) => [attendee.webId, attendee]));
  const state: Invitation = {
    ...previous,
    sequence: nextSequence(previous),
    attendees: next.map((attendee) => ({
      ...attendee,
      status: old.get(attendee.webId)?.status ?? "NEEDS-ACTION",
    })),
  };
  const removed = previous.attendees.filter(
    (attendee) => !next.some((a) => a.webId === attendee.webId),
  );
  const messages: InvitationMessagePlan[] = [];
  const common = base(state, dtstamp);
  if (removed.length) {
    messages.push({
      ...common,
      method: "CANCEL",
      from: state.organizer,
      to: removed.map((a) => a.webId),
    });
  }
  if (next.length) messages.push(planInvite(state, actor, dtstamp));
  return { state, messages };
}

/** A reply addresses only the organizer and never advances the event's SEQUENCE. */
export function planReply(
  input: Invitation,
  actor: string,
  participation: ParticipationStatus,
  dtstamp: string,
): ReplyPlan {
  const state = invitation(input);
  active(state);
  identity(actor);
  if (!state.attendees.some((attendee) => attendee.webId === actor))
    throw new InvitationError("forbidden");
  status(participation);
  return {
    ...base(state, dtstamp),
    method: "REPLY",
    from: actor,
    to: state.organizer,
    status: participation,
  };
}

/** actor MUST be the authenticated sender, supplied by the adapter rather than the message. */
export function applyReply(
  input: Invitation,
  actor: string,
  reply: ReplyPlan,
): { readonly state: Invitation; readonly outcome: "applied" | "ignored-stale" } {
  const state = invitation(input);
  shape(reply, ["uid", "organizer", "sequence", "dtstamp", "method", "from", "to", "status"]);
  text(reply.uid);
  identity(reply.organizer);
  identity(reply.from);
  identity(reply.to);
  identity(actor);
  sequence(reply.sequence);
  timestamp(reply.dtstamp);
  status(reply.status);
  if (reply.method !== "REPLY") throw new InvitationError("invalid-input");
  if (actor !== reply.from) throw new InvitationError("forbidden");
  if (
    reply.uid !== state.uid ||
    reply.organizer !== state.organizer ||
    reply.to !== state.organizer
  ) {
    throw new InvitationError("event-mismatch");
  }
  // Includes replies from people removed at a newer revision, even after cancellation.
  if (reply.sequence < state.sequence) return { state, outcome: "ignored-stale" };
  if (reply.sequence > state.sequence) throw new InvitationError("future-reply");
  active(state);
  const member = state.attendees.find((attendee) => attendee.webId === actor);
  if (!member) throw new InvitationError("forbidden");
  if (member.repliedAt !== null && reply.dtstamp <= member.repliedAt) {
    return { state, outcome: "ignored-stale" };
  }
  return {
    state: {
      ...state,
      attendees: state.attendees.map((attendee) =>
        attendee.webId === actor
          ? { ...attendee, status: reply.status, repliedAt: reply.dtstamp }
          : attendee,
      ),
    },
    outcome: "applied",
  };
}

export function cancelInvitation(
  input: Invitation,
  actor: string,
  dtstamp: string,
): InvitationChange {
  const state = invitation(input);
  organizerOnly(state, actor);
  const cancelled = { ...state, sequence: nextSequence(state), cancelled: true };
  const message: CancelPlan = {
    ...base(cancelled, dtstamp),
    method: "CANCEL",
    from: state.organizer,
    to: state.attendees.map((attendee) => attendee.webId),
  };
  return { state: cancelled, messages: [message] };
}

/** Every status is present, including zero counts. No locale-dependent display strings. */
export function summarizeInvitation(input: Invitation): {
  readonly total: number;
  readonly counts: Readonly<Record<ParticipationStatus, number>>;
} {
  const state = invitation(input);
  const counts: Record<ParticipationStatus, number> = {
    "NEEDS-ACTION": 0,
    ACCEPTED: 0,
    DECLINED: 0,
    TENTATIVE: 0,
    DELEGATED: 0,
  };
  for (const attendee of state.attendees) counts[attendee.status]++;
  return { total: state.attendees.length, counts };
}
