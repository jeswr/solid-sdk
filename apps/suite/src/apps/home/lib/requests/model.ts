// AUTHORED-BY Claude Opus 5.5
/**
 * The Requests inbox view model (03-home-permissions §2.5): requester names, the ConsentSheet
 * headline rule, one card per Home data type, the pending/decided split and plain-language copy.
 * Requests are requester-authored and untrusted: the only IRI ever shown is an unsorted class's own
 * IRI, as secondary text under its name, so the owner can see exactly what was asked for.
 */

import {
  type AccessRequestEntry,
  RequestConflictError,
  type RequestMode,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import { isRoleError } from "@jeswr/pod-access/roles";
import { classificationForClass } from "../model/domains";
import { httpUrl } from "../model/rdf";
import { dpvPurposeLabel } from "../permissions/dpvLabels";

export type ReadableRequest = Exclude<AccessRequestEntry, { status: "unreadable" }>;
export type UnreadableRequest = Extract<AccessRequestEntry, { status: "unreadable" }>;

const DAY = 86_400_000;
/** Decided requests stay in the history this long (§2.5). */
export const DECIDED_WINDOW_DAYS = 30;
const MAX_NAME = 80;
const MAX_CLASS_NAME = 60;
const MAX_PURPOSE = 200;

/** Format characters (bidi overrides, zero-width joiners) can disguise requester-written text. */
function plainText(value: string): string {
  return value
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

function capped(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function isReadable(entry: AccessRequestEntry): entry is ReadableRequest {
  return entry.status !== "unreadable";
}

/** The requester's host, shown beside a requester-chosen name (which proves nothing). */
export function requesterHost(entry: Pick<ReadableRequest, "requester">): string | undefined {
  return httpUrl(entry.requester)?.host;
}

/** The notification's own name, else the requester's host, else "Someone". */
export function requesterName(entry: Pick<ReadableRequest, "requester" | "requesterName">): string {
  const named = entry.requesterName === undefined ? "" : plainText(entry.requesterName);
  if (named) return capped(named, MAX_NAME);
  return requesterHost(entry) ?? "Someone";
}

/** Up to two initials for the avatar fallback. */
export function initials(name: string): string {
  return (
    name
      .split(/[\s.\-_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => (Array.from(word)[0] as string).toLocaleUpperCase())
      .join("") || "?"
  );
}

/**
 * A purpose as words: a known DPV purpose's label, or the requester's own text, cleaned of
 * disguising characters and capped. Unknown IRIs have no words to show, so they are omitted
 * rather than displayed raw.
 */
export function purposeText(purpose: string | undefined): string | undefined {
  const value = purpose === undefined ? "" : plainText(purpose);
  if (!value) return undefined;
  if (httpUrl(value)) return dpvPurposeLabel(value);
  return /^[a-z][\w+.-]*:\S*$/i.test(value) ? undefined : capped(value, MAX_PURPOSE);
}

/** Lower-case a sentence-case label for use mid-sentence, leaving acronyms ("GPS data") alone. */
function midSentence(text: string): string {
  const [first, second] = Array.from(text) as [string, string | undefined];
  return second !== undefined && /\p{Lu}/u.test(second)
    ? text
    : first.toLocaleLowerCase() + text.slice(first.length);
}

/** §2.5: "To {purpose}, {name} requests access to:" or "{name} requests access to:". */
export function headline(name: string, purpose: string | undefined): string {
  const text = purposeText(purpose);
  return text
    ? `To ${midSentence(text)}, ${name} requests access to:`
    : `${name} requests access to:`;
}

/** The purpose line under a row: the purpose as a sentence, when it has words. */
export function purposeLine(purpose: string | undefined): string | undefined {
  const text = purposeText(purpose);
  if (!text) return undefined;
  const first = Array.from(text)[0] as string;
  return first.toLocaleUpperCase() + text.slice(first.length);
}

export interface RequestCard {
  /** The Home data type id, or the requested IRI when the Home model has no data type for it. */
  id: string;
  label: string;
  description: string;
  /** For a class the Home model doesn't sort: its full IRI, shown under the label. */
  classIri?: string;
  /** Home domain id, for item counts from the Home model. */
  domainId?: string;
  /** The request's data type IRIs this card stands for. */
  dataTypes: string[];
  /**
   * The data types a sharing role can grant (read or change was asked for); only these are sent
   * to decide. Append-only and mode-less types have no role, so the SDK would refuse them.
   */
  shareableTypes: string[];
  modes: RequestMode[];
}

const OTHER_DESCRIPTION = "Data this request names that isn't sorted into your usual data types.";
/** Shown instead of a role for cards no sharing role can grant. */
export const ADD_ONLY_TEXT = "Can only add — can't be shared yet";

/** A class's own name: its fragment or last path segment, cleaned for display. */
export function classLocalName(iri: string): string {
  let raw = "";
  try {
    const url = new URL(iri);
    raw = url.hash.slice(1) || (url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    raw = iri.split(/[#/]/).filter(Boolean).at(-1) ?? "";
  }
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* Keep the encoded form. */
  }
  return capped(plainText(decoded), MAX_CLASS_NAME) || "Other data";
}

function shareable(modes: readonly RequestMode[] | undefined): boolean {
  return modes?.includes("read") === true || modes?.includes("write") === true;
}

/**
 * One card per Home data type; requested IRIs of the same data type share a card. Each class the
 * Home model doesn't sort gets its own card, named after the class.
 */
export function requestCards(
  entry: Pick<ReadableRequest, "dataTypes" | "modesByType">,
): RequestCard[] {
  const cards = new Map<string, RequestCard>();
  for (const iri of entry.dataTypes) {
    const { domain, dataType } = classificationForClass(iri);
    const id = dataType?.id ?? iri;
    const card: RequestCard = cards.get(id) ?? {
      id,
      ...(dataType
        ? { label: dataType.label, description: dataType.description, domainId: domain.id }
        : {
            label: classLocalName(iri),
            description: OTHER_DESCRIPTION,
            classIri: plainText(iri),
          }),
      dataTypes: [],
      shareableTypes: [],
      modes: [],
    };
    const modes = entry.modesByType[iri];
    card.dataTypes.push(iri);
    if (shareable(modes)) card.shareableTypes.push(iri);
    card.modes = [...new Set([...card.modes, ...(modes ?? [])])];
    cards.set(id, card);
  }
  return [...cards.values()];
}

export function isShareable(card: RequestCard): boolean {
  return card.shareableTypes.length > 0;
}

/** Sorted data types start checked; unsorted classes and add-only cards wait for the owner. */
export function initialSelection(cards: readonly RequestCard[]): string[] {
  return cards.filter((card) => !card.classIri && isShareable(card)).map((card) => card.id);
}

/** The plain role a card's modes amount to (§7 role labels). */
export function accessText(modes: readonly RequestMode[]): string {
  if (modes.includes("write")) return "Can change";
  if (modes.includes("read")) return "Can see";
  return "Can add";
}

/** What the checked cards share: only data types a role can grant. */
export function selectedDataTypes(
  cards: readonly RequestCard[],
  selected: readonly string[],
): string[] {
  return [
    ...new Set(
      cards.filter((card) => selected.includes(card.id)).flatMap((card) => card.shareableTypes),
    ),
  ];
}

/** "Activity", "Activity and Sleep", "Activity, Sleep and Steps". */
export function listText(items: readonly string[]): string {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
}

/** One label per card: distinct classes that share a name are still listed separately. */
export function cardLabels(cards: readonly RequestCard[], selected?: readonly string[]): string[] {
  return cards
    .filter((card) => selected === undefined || selected.includes(card.id))
    .map((card) => card.label);
}

const NOT_TOLD = (name: string) =>
  ` We couldn't tell ${name}; they'll see it next time they check.`;

export function approvedMessage(
  name: string,
  cards: readonly RequestCard[],
  selected: readonly string[],
  notified: boolean,
): string {
  const chosen = cards.filter((card) => selected.includes(card.id) && isShareable(card));
  const verb = chosen.some((card) => card.modes.includes("write")) ? "see and change" : "see";
  return `${name} can now ${verb} your ${listText(cardLabels(chosen))}.${notified ? "" : NOT_TOLD(name)}`;
}

export function deniedMessage(name: string, notified: boolean): string {
  return `You denied ${name}'s request.${notified ? "" : NOT_TOLD(name)}`;
}

/**
 * Finishing an interrupted approval resumes the choices pinned when it started, which may be a
 * subset of what was asked for: the message names no data types, only what the result says.
 */
export function finishedMessage(name: string, notified: boolean): string {
  return `You finished approving ${name}'s request.${notified ? "" : NOT_TOLD(name)}`;
}

/** Added to a confirmation when an expiry was sent but the storage won't enforce it. */
export const EXPIRY_NOT_ENFORCED =
  "Access won't end automatically on this storage; remove it from Permissions when you're done.";

function time(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface RequestLists {
  /** Pending (and interrupted approving) requests, newest first. */
  pending: ReadableRequest[];
  /** Approved and denied within the last 30 days, most recently decided first. */
  decided: ReadableRequest[];
  /**
   * Inbox notifications that aren't access requests or couldn't be read. Nothing can answer
   * them, so they are never counted as waiting.
   */
  unreadable: UnreadableRequest[];
}

/**
 * Split the inbox. `answered` holds requests decided in this session: they leave the waiting lists
 * at once, before (or even without) a fresh listing showing their new status.
 */
export function splitRequests(
  entries: readonly AccessRequestEntry[],
  now: Date,
  answered: ReadonlySet<string> = new Set(),
): RequestLists {
  const readable = entries.filter(isReadable);
  const since = now.getTime() - DECIDED_WINDOW_DAYS * DAY;
  return {
    pending: readable
      .filter(
        (entry) =>
          (entry.status === "pending" || entry.status === "approving") && !answered.has(entry.id),
      )
      .sort((a, b) => time(b.created) - time(a.created) || a.id.localeCompare(b.id)),
    decided: readable
      .filter(
        (entry) =>
          (entry.status === "approved" || entry.status === "denied") &&
          time(entry.decidedAt) >= since,
      )
      .sort((a, b) => time(b.decidedAt) - time(a.decidedAt) || a.id.localeCompare(b.id)),
    unreadable: entries.filter(
      (entry): entry is UnreadableRequest => !isReadable(entry) && !answered.has(entry.id),
    ),
  };
}

export function decidedText(entry: ReadableRequest, formatDate: (value: string) => string): string {
  const when = entry.decidedAt ? ` ${formatDate(entry.decidedAt)}` : "";
  return `${entry.status === "approved" ? "Approved" : "Denied"}${when}`;
}

export type ReviewError =
  | { kind: "conflict" }
  | {
      kind: "error";
      category: "unsupported" | "unreachable" | "unknown";
      message: string;
      /** Whether running the same decision again can succeed. */
      retry: boolean;
      /** An approval is pinned with other choices: only finishing it (no choices) can work. */
      finish?: true;
      /** Approving can't work, but denying can: offer Deny first. */
      deny?: true;
    };

/** Shown for any failure without a known plain-language cause; the raw error goes to the console. */
export const NOT_SAVED = "Your answer wasn't saved. Try again.";

/** Plain copy for the SDK's known refusals, matched on its messages. */
const CHANGED = "Something else changed this request at the same time. Try again.";
const KNOWN_ERRORS: readonly {
  match: RegExp;
  message: string;
  retry: boolean;
  finish?: true;
  deny?: true;
}[] = [
  { match: /^Conditional write failed \(412\)|kept changing/, message: CHANGED, retry: true },
  {
    match: /needs an owner registration|Registered container is missing/,
    message: "Some of this data isn't registered in your pod, so it can't be shared from here.",
    retry: false,
  },
  {
    match: /claims an approval that was never recorded/,
    message:
      "This request says it was already approved, but your pod has no record of that. You can still deny it.",
    retry: false,
    deny: true,
  },
  {
    match: /only asks to add data|grants no requested modes/,
    message: "This request only asks to add data, which can't be shared yet.",
    retry: false,
  },
  {
    match: /^Cannot deny an approval/,
    message:
      "Approving this request has already started, so it can't be denied now. Finish approving it, then remove access from Permissions if you change your mind.",
    retry: false,
    finish: true,
  },
  {
    match: /^Cannot approve a denial/,
    message: "You already denied this request, so it can't be approved.",
    retry: false,
  },
  {
    match: /^An earlier approval of this request is still finishing with different choices/,
    message:
      "An earlier approval of this request, with different choices, is still finishing. Choose Finish approving to complete it as it was first chosen, or deny it.",
    retry: false,
    finish: true,
  },
  {
    match: /^Request no longer exists/,
    message: "This request isn't in your inbox any more.",
    retry: false,
  },
];

/**
 * What the sheet shows for a failed decision: plain copy for the SDK's known refusals and fixed
 * copy otherwise (SDK messages can name URLs and internals, so they only reach the console). A
 * race with another decision is not an error for the user, and ACP storage gets its own copy.
 */
export function reviewError(error: unknown, approve: boolean, online = true): ReviewError {
  if (error instanceof RequestConflictError) return { kind: "conflict" };
  if (error instanceof UnsupportedAccessModelError)
    return {
      kind: "error",
      category: "unsupported",
      message: approve
        ? "Approving requests isn't available on this storage yet"
        : "Answering requests isn't available on this storage yet",
      retry: false,
    };
  if (!online)
    return {
      kind: "error",
      category: "unreachable",
      message: "You're offline. Reconnect and try again.",
      retry: true,
    };
  // Sharing-layer refusals name the document they hit, so their own messages are never shown.
  if (isRoleError(error)) {
    if (error.code === "unsupported")
      return {
        kind: "error",
        category: "unsupported",
        message: "Sharing this data isn't available on this storage yet",
        retry: false,
      };
    if (error.code === "owner-lockout")
      return {
        kind: "error",
        category: "unknown",
        message: "Sharing this would lock you out of your own data, so nothing was changed.",
        retry: false,
      };
    if (error.code !== "conflict") console.error("Access request decision failed", error);
    return {
      kind: "error",
      category: "unknown",
      message: error.code === "conflict" ? CHANGED : NOT_SAVED,
      retry: true,
    };
  }
  const message = error instanceof Error ? error.message.trim() : "";
  const known = KNOWN_ERRORS.find((candidate) => candidate.match.test(message));
  if (known)
    return {
      kind: "error",
      category: "unknown",
      message: known.message,
      retry: known.retry,
      ...(known.finish && { finish: true as const }),
      ...(known.deny && { deny: true as const }),
    };
  console.error("Access request decision failed", error);
  return { kind: "error", category: "unknown", message: NOT_SAVED, retry: true };
}
