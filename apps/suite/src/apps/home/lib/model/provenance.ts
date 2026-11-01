// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Host patterns ported from PM docs/typed-data-views.md §2.1 and typed-views/sources.ts.
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { httpUrl, inStorage, subjectOf } from "./rdf";

export interface Provenance {
  kind: "source" | "app" | "you";
  label: string;
  logoId?: string;
}
export interface Connector {
  id: string;
  label: string;
  hosts: readonly string[];
}

export const CONNECTORS: readonly Connector[] = [
  { id: "spotify", label: "Spotify", hosts: ["spotify.com"] },
  { id: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { id: "pinterest", label: "Pinterest", hosts: ["pinterest.com"] },
  { id: "google-photos", label: "Google Photos", hosts: ["photos.google.com"] },
  { id: "google-calendar", label: "Google Calendar", hosts: ["calendar.google.com"] },
  { id: "strava", label: "Strava", hosts: ["strava.com"] },
  { id: "fitbit", label: "Fitbit", hosts: ["fitbit.com"] },
  { id: "garmin", label: "Garmin", hosts: ["connect.garmin.com"] },
  { id: "github", label: "GitHub", hosts: ["github.com"] },
  { id: "reddit", label: "Reddit", hosts: ["reddit.com"] },
  { id: "x-twitter", label: "X", hosts: ["x.com", "twitter.com"] },
  { id: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { id: "tiktok", label: "TikTok", hosts: ["tiktok.com"] },
  { id: "facebook", label: "Facebook", hosts: ["facebook.com"] },
  { id: "notion", label: "Notion", hosts: ["notion.so"] },
  { id: "steam", label: "Steam", hosts: ["store.steampowered.com"] },
  { id: "goodreads", label: "Goodreads", hosts: ["goodreads.com"] },
  { id: "slack", label: "Slack", hosts: ["slack.com"] },
  { id: "discord", label: "Discord", hosts: ["discord.com"] },
  { id: "twitch", label: "Twitch", hosts: ["twitch.tv"] },
  { id: "dropbox", label: "Dropbox", hosts: ["dropbox.com"] },
  { id: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"] },
  { id: "netflix", label: "Netflix", hosts: [] },
  { id: "amazon-orders", label: "Amazon orders", hosts: [] },
  { id: "apple-health", label: "Apple Health", hosts: [] },
  { id: "whatsapp", label: "WhatsApp", hosts: [] },
  { id: "uber", label: "Uber", hosts: [] },
  { id: "chatgpt", label: "ChatGPT", hosts: [] },
  { id: "bank-statements", label: "Bank statements", hosts: [] },
  { id: "google-takeout", label: "Google Takeout", hosts: [] },
];

export function connectorForUrl(value: string): Connector | undefined {
  const url = httpUrl(value);
  if (!url) return undefined;
  if (
    ["google.com", "www.google.com"].includes(url.hostname) &&
    /^\/calendar(?:\/|$)/.test(url.pathname)
  ) {
    return CONNECTORS.find((connector) => connector.id === "google-calendar");
  }
  return CONNECTORS.find((connector) =>
    connector.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)),
  );
}

export interface ProvenanceContext {
  userWebId?: string;
  /** Pre-resolved identity metadata: no implicit third-party requests while classifying RDF. */
  identities?: ReadonlyMap<string, { kind: "app" | "person"; label: string }>;
  storage?: string;
}

function providedBy(connector: Connector): Provenance {
  return { kind: "source", label: connector.label, logoId: connector.id };
}

/** Resolve only names already present in the loaded item graph; never dereference an agent. */
export function identitiesIn(
  dataset: DatasetCore,
  subject: string | Term,
): NonNullable<ProvenanceContext["identities"]> {
  const node = subjectOf(dataset, subject);
  const identities = new Map<string, { kind: "app" | "person"; label: string }>();
  for (const predicate of ["wasAttributedTo", "wasGeneratedBy"]) {
    for (const iri of node.iris(NS.PROV + predicate)) {
      const agent = subjectOf(dataset, iri);
      const label = agent.name?.trim();
      if (!label || /http/i.test(label)) continue;
      const person = agent.types.some((type) =>
        [
          `${NS.FOAF}Person`,
          `${NS.SCHEMA}Person`,
          `${NS.VCARD}Individual`,
          `${NS.PROV}Person`,
        ].includes(type),
      );
      identities.set(iri, { kind: person ? "person" : "app", label });
    }
  }
  return identities;
}

/** Home §5.3, in precedence order; labels contain names, never raw identifiers. */
export function provenanceOf(
  dataset: DatasetCore,
  subject: string | Term,
  containerUrl: string,
  context: ProvenanceContext = {},
): Provenance {
  const node = subjectOf(dataset, subject);
  let attributedToAnother = false;
  for (const value of node.sourceUrls) {
    const connector = connectorForUrl(value);
    if (connector) return providedBy(connector);
  }
  for (const predicate of ["wasAttributedTo", "wasGeneratedBy"]) {
    for (const iri of node.iris(NS.PROV + predicate)) {
      if (iri === context.userWebId) continue;
      attributedToAnother = true;
      const identity = context.identities?.get(iri);
      if (identity?.label.trim() && !/http/i.test(identity.label))
        return { kind: identity.kind === "app" ? "app" : "source", label: identity.label.trim() };
    }
  }
  const url = httpUrl(containerUrl);
  if (url && (context.storage === undefined || inStorage(containerUrl, context.storage))) {
    const relative =
      context.storage === undefined
        ? url.pathname
        : url.pathname.slice(new URL(context.storage).pathname.length);
    const id = /(?:^|\/)integrations\/([^/]+)\//.exec(relative)?.[1];
    const connector = CONNECTORS.find((connector) => connector.id === id);
    if (connector) return providedBy(connector);
  }
  return attributedToAnother
    ? { kind: "app", label: "another app" }
    : { kind: "you", label: "Added by you" };
}
