// AUTHORED-BY Claude Opus 5.5
/**
 * The Requests inbox view model (03-home-permissions §2.5): requester names, the ConsentSheet
 * headline rule, one card per Home data type, the pending/decided split and plain-language copy.
 * Requests are requester-authored and untrusted: nothing here ever shows a raw IRI.
 */

import {
  type AccessRequestEntry,
  RequestConflictError,
  type RequestMode,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import { classificationForClass } from "../model/domains";
import { httpUrl } from "../model/rdf";
import { dpvPurposeLabel } from "../permissions/dpvLabels";

export type ReadableRequest = Exclude<AccessRequestEntry, { status: "unreadable" }>;

const DAY = 86_400_000;
/** Decided requests stay in the history this long (§2.5). */
export const DECIDED_WINDOW_DAYS = 30;
const MAX_NAME = 80;

export function isReadable(entry: AccessRequestEntry): entry is ReadableRequest {
  return entry.status !== "unreadable";
}

/** The requester's host, shown beside a requester-chosen name (which proves nothing). */
export function requesterHost(entry: Pick<ReadableRequest, "requester">): string | undefined {
  return httpUrl(entry.requester)?.host;
}

/** The notification's own name, else the requester's host, else "Someone". */
export function requesterName(entry: Pick<ReadableRequest, "requester" | "requesterName">): string {
  const named = entry.requesterName?.replace(/\s+/g, " ").trim();
  if (named) return named.length > MAX_NAME ? `${named.slice(0, MAX_NAME - 1)}…` : named;
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
 * A purpose as words: a known DPV purpose's label, or the requester's own text. Unknown IRIs
 * have no words to show, so they are omitted rather than displayed raw.
 */
export function purposeText(purpose: string | undefined): string | undefined {
  const value = purpose?.replace(/\s+/g, " ").trim();
  if (!value) return undefined;
  if (httpUrl(value)) return dpvPurposeLabel(value);
  return /^[a-z][\w+.-]*:\S*$/i.test(value) ? undefined : value;
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
  /** Home domain id, for item counts from the Home model. */
  domainId?: string;
  /** The request's data type IRIs this card stands for (sent to decide when checked). */
  dataTypes: string[];
  modes: RequestMode[];
}

const OTHER = {
  label: "Other data",
  description: "Data this request names that isn't sorted into your usual data types.",
};

/** One card per Home data type; requested IRIs of the same data type share a card. */
export function requestCards(
  entry: Pick<ReadableRequest, "dataTypes" | "modesByType">,
): RequestCard[] {
  const cards = new Map<string, RequestCard>();
  for (const iri of entry.dataTypes) {
    const { domain, dataType } = classificationForClass(iri);
    const id = dataType?.id ?? iri;
    const card = cards.get(id) ?? {
      id,
      ...(dataType
        ? { label: dataType.label, description: dataType.description, domainId: domain.id }
        : OTHER),
      dataTypes: [],
      modes: [],
    };
    card.dataTypes.push(iri);
    card.modes = [...new Set([...card.modes, ...(entry.modesByType[iri] ?? [])])];
    cards.set(id, card);
  }
  return [...cards.values()];
}

/** The plain role a card's modes amount to (§7 role labels). */
export function accessText(modes: readonly RequestMode[]): string {
  if (modes.includes("write")) return "Can change";
  if (modes.includes("read")) return "Can see";
  return "Can add";
}

export function selectedDataTypes(
  cards: readonly RequestCard[],
  selected: readonly string[],
): string[] {
  return [
    ...new Set(
      cards.filter((card) => selected.includes(card.id)).flatMap((card) => card.dataTypes),
    ),
  ];
}

/** "Activity", "Activity and Sleep", "Activity, Sleep and Steps". */
export function listText(items: readonly string[]): string {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(items);
}

export function cardLabels(cards: readonly RequestCard[], selected?: readonly string[]): string[] {
  return [
    ...new Set(
      cards
        .filter((card) => selected === undefined || selected.includes(card.id))
        .map((card) => card.label),
    ),
  ];
}

const NOT_TOLD = (name: string) =>
  ` We couldn't tell ${name}; they'll see it next time they check.`;

export function approvedMessage(
  name: string,
  cards: readonly RequestCard[],
  selected: readonly string[],
  notified: boolean,
): string {
  const chosen = cards.filter((card) => selected.includes(card.id));
  const verb = chosen.some((card) => card.modes.includes("write")) ? "see and change" : "see";
  return `${name} can now ${verb} your ${listText(cardLabels(chosen))}.${notified ? "" : NOT_TOLD(name)}`;
}

export function deniedMessage(name: string, notified: boolean): string {
  return `You denied ${name}'s request.${notified ? "" : NOT_TOLD(name)}`;
}

function time(value: string | undefined): number {
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface RequestLists {
  /** Pending (and interrupted approving) requests, newest first. */
  pending: ReadableRequest[];
  /** Approved and denied within the last 30 days, most recently decided first. */
  decided: ReadableRequest[];
  /** Notifications that couldn't be read. */
  unreadable: number;
}

export function splitRequests(entries: readonly AccessRequestEntry[], now: Date): RequestLists {
  const readable = entries.filter(isReadable);
  const since = now.getTime() - DECIDED_WINDOW_DAYS * DAY;
  return {
    pending: readable
      .filter((entry) => entry.status === "pending" || entry.status === "approving")
      .sort((a, b) => time(b.created) - time(a.created) || a.id.localeCompare(b.id)),
    decided: readable
      .filter(
        (entry) =>
          (entry.status === "approved" || entry.status === "denied") &&
          time(entry.decidedAt) >= since,
      )
      .sort((a, b) => time(b.decidedAt) - time(a.decidedAt) || a.id.localeCompare(b.id)),
    unreadable: entries.length - readable.length,
  };
}

export function unreadableNotice(count: number): string {
  return `${count} ${count === 1 ? "request" : "requests"} couldn't be read`;
}

export function decidedText(entry: ReadableRequest, formatDate: (value: string) => string): string {
  const when = entry.decidedAt ? ` ${formatDate(entry.decidedAt)}` : "";
  return `${entry.status === "approved" ? "Approved" : "Denied"}${when}`;
}

export type ReviewError =
  | { kind: "conflict" }
  | { kind: "error"; category: "unsupported" | "unreachable" | "unknown"; message: string };

/**
 * What the sheet shows for a failed decision. The SDK's errors carry user-readable messages; a
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
    };
  if (!online)
    return {
      kind: "error",
      category: "unreachable",
      message: "You're offline. Reconnect and try again.",
    };
  const message = error instanceof Error ? error.message.trim() : "";
  return {
    kind: "error",
    category: "unknown",
    message: message || "Your answer wasn't saved. Try again.",
  };
}
