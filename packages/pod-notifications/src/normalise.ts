// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChangeEvent, ChangeType } from "./types.js";

const AS = "https://www.w3.org/ns/activitystreams#";
const LWS = "https://www.w3.org/ns/lws#";
const LDP = "http://www.w3.org/ns/ldp#";
const VERBS: readonly string[] = ["Create", "Update", "Delete", "Move", "Add", "Remove"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function id(value: unknown): string | undefined {
  const candidate = record(value) ? value.id : value;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function kind(value: unknown): ChangeEvent["objectKind"] {
  if (!record(value)) return "unknown";
  const types = values(value.type);
  if (
    types.some((t) =>
      ["Container", `${LWS}Container`, `${LDP}Container`, `${LDP}BasicContainer`].includes(
        t as string,
      ),
    )
  )
    return "container";
  if (
    types.some((t) =>
      [
        "DataResource",
        `${LWS}DataResource`,
        `${LDP}Resource`,
        `${LDP}RDFSource`,
        `${LDP}NonRDFSource`,
      ].includes(t as string),
    )
  )
    return "resource";
  return "unknown";
}

/** Storage id and resource scope are separate (an LWS id need not be its root URL). */
export interface NormalisationOptions {
  storageId: string;
  isWithinStorage: (url: string) => boolean;
  via: ChangeEvent["via"];
  now?: () => number;
}

/**
 * Normalise decoded Solid AS2 or LWS Notification messages without JSON-LD context fetching.
 * Unknown/malformed activities and foreign storage/resources are dropped before id deduplication.
 * Each normaliser owns a five-second dedupe window; create one per subscription.
 */
export function createChangeNormalizer(
  options: NormalisationOptions,
): (raw: unknown) => ChangeEvent[] {
  const seen = new Map<string, number>();
  const now = options.now ?? Date.now;
  const scoped = (url: string) => {
    if (!/^https?:\/\//i.test(url) || /[\u0000-\u0020\\]/u.test(url) || !URL.canParse(url)) return false;
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && options.isWithinStorage(url);
  };
  return (raw) => {
    if (!record(raw)) return [];
    const time = now();
    for (const [key, expires] of seen) if (expires <= time) seen.delete(key);
    const envelope = values(raw.type).some(
      (type) => type === "Notification" || type === `${LWS}Notification`,
    );
    if (envelope && raw.storage !== options.storageId) return [];
    const activities = envelope ? values(raw.activity) : [raw];
    const events: ChangeEvent[] = [];
    for (const activity of activities) {
      if (!record(activity)) continue;
      const type = values(activity.type)
        .map((t) => (typeof t === "string" && t.startsWith(AS) ? t.slice(AS.length) : t))
        .find((t) => VERBS.includes(t as string)) as ChangeType | undefined;
      const object = id(activity.object);
      if (!type || !object || !scoped(object)) continue;
      const published =
        typeof activity.published === "string" ? new Date(activity.published) : new Date(time);
      if (!Number.isFinite(published.getTime())) continue;
      const eventId = id(activity.id) ?? `${object}#${published.toISOString()}`;
      if (seen.has(eventId)) continue;
      seen.set(eventId, time + 5_000);
      const event: ChangeEvent = {
        type,
        object,
        objectKind: kind(activity.object),
        published,
        id: eventId,
        via: options.via,
        raw,
      };
      for (const field of ["target", "origin"] as const) {
        const url = id(activity[field]);
        if (url && scoped(url)) event[field] = url;
      }
      const actor = id(activity.actor);
      if (actor) event.actor = actor;
      if (typeof activity.state === "string") event.state = activity.state;
      events.push(event);
    }
    return events;
  };
}
