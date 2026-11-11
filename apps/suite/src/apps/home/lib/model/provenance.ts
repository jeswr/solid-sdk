// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Host patterns ported from PM docs/typed-data-views.md §2.1 and typed-views/sources.ts.
import { adapterContainerUrl } from "@jeswr/pod-connectors";
import { DEMO_CONNECTOR, NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { isClientIdDocument, resolveClientName } from "../permissions";
import { httpUrl, inStorage, subjectOf } from "./rdf";

export interface Provenance {
  /** `other`: another agent the loaded data doesn't name or type, person or software. */
  kind: "source" | "app" | "person" | "other" | "you";
  label: string;
  logoId?: string;
  /** Demo status is additional to the item's real source or author. */
  demo?: true;
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
  /** URL of the document Home actually read, independent of its selected RDF subject. */
  documentUrl?: string;
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
      const label = subjectOf(dataset, iri).name?.trim();
      if (!label || /http/i.test(label)) continue;
      identities.set(iri, { kind: isPerson(dataset, iri) ? "person" : "app", label });
    }
  }
  return identities;
}

/** One resolver per Home load: repeated agents share even an in-flight metadata lookup. */
export function createIdentityResolver(publicFetch: typeof fetch = globalThis.fetch) {
  const clients = new Map<string, Promise<string>>();
  return async (dataset: DatasetCore, subject: string | Term, userWebId?: string) => {
    const identities = new Map(identitiesIn(dataset, subject));
    const node = subjectOf(dataset, subject);
    await Promise.all(
      ["wasAttributedTo", "wasGeneratedBy"].flatMap((predicate) =>
        node.iris(NS.PROV + predicate).map(async (iri) => {
          if (iri === userWebId || iri === DEMO_CONNECTOR.iri || identities.has(iri)) return;
          const url = httpUrl(iri);
          const typed = typedAgent(dataset, iri);
          if (!url || typed === "person" || (typed === undefined && url.hash)) return;
          let name = clients.get(iri);
          if (!name) {
            name = isClientIdDocument(iri)
              ? resolveClientName(iri, publicFetch).then((metadata) => {
                  const label = metadata.name?.trim();
                  return label && !/http/i.test(label) ? label : url.hostname;
                })
              : Promise.resolve(url.hostname);
            clients.set(iri, name);
          }
          identities.set(iri, { kind: "app", label: await name });
        }),
      ),
    );
    return identities;
  };
}

const PERSON_TYPES = [
  `${NS.FOAF}Person`,
  `${NS.SCHEMA}Person`,
  `${NS.VCARD}Individual`,
  `${NS.PROV}Person`,
];
/** Whether the loaded graph types this agent as a person (e.g. a WebID's profile). */
function isPerson(dataset: DatasetCore, iri: string): boolean {
  return subjectOf(dataset, iri).types.some((type) => PERSON_TYPES.includes(type));
}
const SOFTWARE_TYPES = [
  `${NS.PROV}SoftwareAgent`,
  `${NS.SCHEMA}SoftwareApplication`,
  "http://schema.org/SoftwareApplication",
  // ActivityStreams actors that are not people (bots, AI agents).
  "https://www.w3.org/ns/activitystreams#Application",
  "https://www.w3.org/ns/activitystreams#Service",
];
/**
 * What the loaded graph says an attributed agent is, without fetching its profile: a person
 * only when typed as one, an app when typed as software (an AI agent included). An IRI's
 * shape proves nothing: an AI agent's WebID (`…/agent#me`) looks just like a person's.
 */
function typedAgent(dataset: DatasetCore, iri: string): "person" | "app" | undefined {
  if (isPerson(dataset, iri)) return "person";
  if (subjectOf(dataset, iri).types.some((type) => SOFTWARE_TYPES.includes(type))) return "app";
  return undefined;
}

/** Home §5.3, in precedence order; labels contain names, never raw identifiers. */
export function provenanceOf(
  dataset: DatasetCore,
  subject: string | Term,
  containerUrl: string,
  context: ProvenanceContext = {},
): Provenance {
  const value = typeof subject === "string" ? subject : subject.value;
  const url =
    typeof subject === "string" || subject.termType === "NamedNode" ? httpUrl(value) : undefined;
  const documentUrl = context.documentUrl;
  const document = documentUrl && httpUrl(documentUrl);
  const storage = context.storage;
  const demo = Boolean(
    url &&
      documentUrl &&
      document &&
      storage &&
      inStorage(storage, storage) &&
      inStorage(value, storage) &&
      url.href.split("#")[0] === document.href.split("#")[0] &&
      CONNECTORS.some((connector) =>
        inStorage(documentUrl, adapterContainerUrl(storage, connector.id)),
      ) &&
      subjectOf(dataset, subject).iris(`${NS.PROV}wasAttributedTo`).includes(DEMO_CONNECTOR.iri),
  );
  const source = sourceOf(dataset, subject, containerUrl, context, demo);
  if (!demo) return source;
  return source.kind === "you"
    ? { kind: "source", label: DEMO_CONNECTOR.label, demo: true }
    : { ...source, demo: true };
}

function sourceOf(
  dataset: DatasetCore,
  subject: string | Term,
  containerUrl: string,
  context: ProvenanceContext,
  demo: boolean,
): Provenance {
  const node = subjectOf(dataset, subject);
  let attributedToAnother = false;
  let attributedToPerson = false;
  let attributedToSomeone = false;
  for (const value of node.sourceUrls) {
    const connector = connectorForUrl(value);
    if (connector) return providedBy(connector);
  }
  for (const predicate of ["wasAttributedTo", "wasGeneratedBy"]) {
    for (const iri of node.iris(NS.PROV + predicate)) {
      if (iri === context.userWebId || (demo && iri === DEMO_CONNECTOR.iri)) continue;
      attributedToAnother = true;
      const identity = context.identities?.get(iri);
      // A person's WebID is labelled with that profile's name, never as an app.
      if (identity?.label.trim() && !/http/i.test(identity.label))
        return { kind: identity.kind, label: identity.label.trim() };
      const typed = typedAgent(dataset, iri);
      if (identity?.kind === "person" || typed === "person") attributedToPerson = true;
      else if (
        // An activity (wasGeneratedBy) is no person, and a resolved or typed app stays one.
        predicate === "wasAttributedTo" &&
        identity?.kind !== "app" &&
        typed === undefined &&
        (httpUrl(iri)?.hash.length ?? 0) > 1
      )
        // A fragment IRI is the usual shape of a WebID, a person's or an agent's alike.
        attributedToSomeone = true;
    }
  }
  const url = httpUrl(containerUrl);
  if (url && (context.storage === undefined || inStorage(containerUrl, context.storage))) {
    const relative =
      context.storage === undefined
        ? url.pathname
        : url.pathname.slice(new URL(context.storage).pathname.length);
    const segments = relative.split("/");
    const index = segments.indexOf("integrations");
    const id = index >= 0 && segments.length > index + 2 ? segments[index + 1] : undefined;
    const connector = CONNECTORS.find((connector) => connector.id === id);
    if (connector) return providedBy(connector);
  }
  if (attributedToPerson) return { kind: "person", label: "another person" };
  if (attributedToSomeone) return { kind: "other", label: "someone else" };
  return attributedToAnother
    ? { kind: "app", label: "another app" }
    : { kind: "you", label: "Added by you" };
}
