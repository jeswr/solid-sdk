// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { type TypedViewData, typedViewRegistry } from "@jeswr/suite-ui";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import { encodeRef } from "../../../lib/refs";
import { type DomainItem, nameFromUrl, sortItems } from "../lib/model/discovery";
import type { DataCategory } from "../lib/model/domains";
import { CONNECTORS, connectorForUrl, provenanceOf } from "../lib/model/provenance";
import { httpUrl, inStorage, primarySubject, subjectOf } from "../lib/model/rdf";
import { protectedDocument } from "./protected-document";

/** Morning from 5:00, afternoon from 12:00, evening from 18:00 (local time). */
export function greetingPeriod(date: Date): "morning" | "afternoon" | "evening" {
  const hour = date.getHours();
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
}

/** The first word of a display name, or "" for a blank one. */
export function firstName(displayName: string): string {
  return displayName.trim().replace(/\s.*$/s, "");
}

export function parseTypes(value: string | null, domain: DataCategory): string[] {
  const ids = domain.dataTypes.map((type) => type.id);
  return value === null ? ids : ids.filter((id) => value.split(",").includes(id));
}

/** null removes the query parameter; an empty string intentionally selects no types. */
export function serializeTypes(value: readonly string[], domain: DataCategory): string | null {
  const selected = domain.dataTypes.map((type) => type.id).filter((id) => value.includes(id));
  return selected.length === domain.dataTypes.length ? null : selected.join(",");
}

export const APP_LINKS = {
  drive: { label: "Drive", href: "/drive" },
  docs: { label: "Docs", href: "/docs" },
  tasks: { label: "Tasks", href: "/tasks" },
  calendar: { label: "Calendar", href: "/calendar" },
} as const;

export function sectionsFor(
  domain: DataCategory,
  items: readonly DomainItem[],
  selected: readonly string[],
  limit: number,
) {
  const types = domain.dataTypes.length
    ? domain.dataTypes
    : [{ id: "other", label: "Other", app: undefined }];
  let remaining = limit;
  return types.flatMap((type) => {
    if (domain.dataTypes.length && !selected.includes(type.id)) return [];
    const matching = sortItems(
      items.filter(
        (item) => item.domain.id === domain.id && (item.dataType?.id ?? "other") === type.id,
      ),
    );
    if (!matching.length) return [];
    const visible = matching.slice(0, type.app ? 6 : remaining);
    if (!type.app) remaining -= visible.length;
    return [
      {
        id: type.id,
        label: type.label,
        app: type.app ? APP_LINKS[type.app] : undefined,
        items: visible,
        hasMore: !type.app && matching.length > visible.length,
      },
    ];
  });
}

// Join the provenance catalogue to Home's life domains without importing connector runtimes.
const CONNECTOR_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  personal: ["google-takeout"],
  documents: ["notion", "dropbox", "chatgpt", "google-takeout"],
  calendar: ["google-calendar", "google-takeout"],
  "body-health": ["strava", "fitbit", "garmin", "apple-health"],
  financial: ["amazon-orders", "bank-statements"],
  media: [
    "spotify",
    "youtube",
    "pinterest",
    "google-photos",
    "steam",
    "goodreads",
    "twitch",
    "netflix",
    "google-takeout",
  ],
  "work-study": ["github", "slack", "linkedin"],
  mobility: ["uber", "strava", "garmin"],
  socials: [
    "reddit",
    "x-twitter",
    "instagram",
    "tiktok",
    "facebook",
    "discord",
    "whatsapp",
    "google-takeout",
  ],
};
export function connectorsForDomain(domain: string) {
  return CONNECTORS.filter((connector) => CONNECTOR_DOMAINS[domain]?.includes(connector.id));
}

export function connectedSources(items: readonly DomainItem[], storage: string) {
  const sources = new Map<string, { id: string; label: string; modified?: string }>();
  for (const item of sortItems(items)) {
    const source = provenanceOf(item.dataset, item.subject, item.containerUrl, { storage });
    const connector = CONNECTORS.find((entry) => entry.id === source.logoId);
    if (source.kind === "source" && connector && !sources.has(connector.id))
      sources.set(connector.id, {
        id: connector.id,
        label: connector.label,
        ...(item.modified ? { modified: item.modified } : {}),
      });
  }
  return [...sources.values()].slice(0, 8);
}

export function relativeTime(value: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(value)) / 1000);
  if (!Number.isFinite(seconds)) return "time unknown";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** A clock time for "as of" lines, in the viewer's locale (e.g. "9:05 AM"). */
export function asOfTime(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function itemTitle(item: DomainItem): string {
  return item.title.trim() && !/http/i.test(item.title) ? item.title : nameFromUrl(item.url);
}

// Match the selected TypedView renderer, with useful details ahead of redundant metadata.
const CARD_FIELDS = new Map<string, readonly string[]>([
  [`${NS.VCARD}Individual`, ["email", "telephone", "organization", "role"]],
  [`${NS.SCHEMA}MusicRecording`, ["artist", "album", "duration"]],
  [`${NS.SCHEMA}Event`, ["start", "end", "location", "description"]],
  [`${NS.WF}Task`, ["status", "due", "description"]],
  [`${NS.POD_DOCS}Document`, ["description"]],
  [`${NS.SCHEMA}Photograph`, ["description", "created", "location"]],
  [`${NS.SCHEMA}ImageObject`, ["description", "created", "location"]],
]);

/** Raw identifiers never become visible card fields, including user-supplied literals. */
export function cardView(item: DomainItem, view: TypedViewData): TypedViewData {
  const rendererType = view.types.find((type) => typedViewRegistry.has(type));
  const fields = rendererType && CARD_FIELDS.get(canonicalize(rendererType));
  const properties = fields
    ? fields.flatMap((key) => view.properties.filter((property) => property.key === key))
    : view.properties;
  return {
    types: view.types,
    title: itemTitle(item),
    ...(view.image ? { image: { ...view.image, alt: itemTitle(item) } } : {}),
    properties: properties
      .map((property) => ({
        ...property,
        values: property.values.filter((value) => !/http/i.test(value)),
      }))
      // Unlabelled predicates and unnamed links are noise on a card; the detail page keeps them.
      .filter((property) => property.label !== "Other detail")
      .map((property) => ({
        ...property,
        values: property.values.filter((value) => value !== "Linked item"),
      }))
      .filter((property) => property.values.length)
      .slice(0, 3),
  };
}

export interface ItemAction {
  id: string;
  label: string;
  href?: string;
  external?: boolean;
}
export function itemHref(item: DomainItem): string {
  const primary = primarySubject(item.dataset, item.url);
  const subject =
    item.subject.termType === "NamedNode" && primary && primary.value !== item.subject.value
      ? `?s=${encodeRef(item.subject.value)}`
      : "";
  const view =
    item.dataType?.id === "contact-details" ? `${subject ? "&" : "?"}view=contact-details` : "";
  return `/home/${item.domain.id}/i/${encodeRef(item.url)}${subject}${view}`;
}
/** Shared by the card and detail page. The response header takes precedence when available. */
export function itemActions(
  item: DomainItem,
  storage: string,
  writable = inStorage(item.url, storage),
  webId?: string,
): ItemAction[] {
  const href = itemHref(item);
  const actions: ItemAction[] = [
    { id: "open", label: "Open", href },
    { id: "access", label: "Who can see this", href: `${href}#access` },
  ];
  if (writable && item.dataType?.id !== "files")
    actions.push({
      id: "edit",
      label: "Edit",
      href: `${href}${href.includes("?") ? "&" : "?"}edit=1`,
    });
  const node = subjectOf(item.dataset, item.subject);
  if (
    writable &&
    !protectedDocument(item, storage, webId) &&
    !item.url.endsWith("/") &&
    !node.types.some((type) => /(?:#Container|#BasicContainer|#DriveRoot)$/.test(type)) &&
    !node.contains.length
  )
    actions.push({ id: "delete", label: "Delete" });
  const source = subjectOf(item.dataset, item.subject).sourceUrls.find((value) => {
    const url = httpUrl(value);
    return url && url.host !== new URL(storage).host;
  });
  if (source) {
    const connector = connectorForUrl(source);
    actions.push({
      id: "source",
      label: `Open in ${connector?.label ?? "source"}`,
      href: source,
      external: true,
    });
  }
  return [...actions, { id: "copy", label: "Copy link" }];
}
