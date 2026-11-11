// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Host patterns ported from PM docs/typed-data-views.md §2.1 and typed-views/sources.ts.
import {
  classifyIpLiteral,
  DEFAULT_HOSTNAME_DENYLIST,
  isDeniedHostname,
  normalizeHostForClassification,
} from "@jeswr/guarded-fetch";
import { adapterContainerUrl, allCatalogEntries } from "@jeswr/pod-connectors";
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

const RESERVED_NAMES = new Set(
  [
    "you",
    "me",
    DEMO_CONNECTOR.label,
    ...CONNECTORS.map(({ label }) => label),
    ...allCatalogEntries().map(({ name }) => name),
  ].map((name) => name.toLowerCase()),
);

/** Every graph/client name crosses this boundary; reserved labels belong to Home alone. */
export function externalName(name: string | undefined, fallback: string): string {
  const clean = (name ?? "")
    // NFKC folds compatibility forms (full-width letters) before the reserved-label check.
    .normalize("NFKC")
    // Strip every control (Cc) and invisible format (Cf) character: bidi controls, zero-width
    // joiners, soft hyphens, word joiners and tag characters could otherwise disguise a
    // reserved label such as "Spotify" or "you".
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /http/i.test(clean) || RESERVED_NAMES.has(clean.toLowerCase())) return fallback;
  const characters = Array.from(clean);
  return characters.length > 60 ? `${characters.slice(0, 59).join("")}…` : clean;
}

/** Syntactic browser check, with shared IP/name classifiers; no DNS lookup is possible here. */
export function publicAgentUrl(iri: string): boolean {
  const url = httpUrl(iri);
  if (url?.protocol !== "https:" || url.port) return false;
  const host = normalizeHostForClassification(url.hostname).replace(/\.$/, "");
  return (
    host.includes(".") &&
    classifyIpLiteral(host) === 0 &&
    !isDeniedHostname(host, [...DEFAULT_HOSTNAME_DENYLIST, "localhost", ".local", ".internal"])
  );
}

/** Include generating activities for loaded labels, and their associated agents for lookup. */
function agentsIn(dataset: DatasetCore, subject: string | Term) {
  const node = subjectOf(dataset, subject);
  return [
    ...node
      .iris(`${NS.PROV}wasAttributedTo`)
      .map((iri) => ({ iri, generated: false, associated: false })),
    ...node.iris(`${NS.PROV}wasGeneratedBy`).flatMap((iri) => [
      { iri, generated: true, associated: false },
      ...subjectOf(dataset, iri)
        .iris(`${NS.PROV}wasAssociatedWith`)
        .map((agent) => ({
          iri: agent,
          generated: true,
          associated: true,
        })),
    ]),
  ];
}

/** Resolve only names already present in the loaded item graph; never dereference an agent. */
export function identitiesIn(
  dataset: DatasetCore,
  subject: string | Term,
): NonNullable<ProvenanceContext["identities"]> {
  const identities = new Map<string, { kind: "app" | "person"; label: string }>();
  for (const { iri } of agentsIn(dataset, subject)) {
    const name = subjectOf(dataset, iri).name;
    if (name === undefined) continue;
    const label = externalName(name, httpUrl(iri)?.hostname ?? "someone else");
    identities.set(iri, { kind: isPerson(dataset, iri) ? "person" : "app", label });
  }
  return identities;
}

/**
 * One resolver per Home session. On item effects, fetch at most one Client ID document
 * for a graph-typed software agent or an agent associated with its generating activity.
 * Only public-looking HTTPS hosts on port 443, without userinfo or IP literals, qualify;
 * self, demo, people, fragments and graph-named agents are never fetched. At most 20
 * distinct agents qualify per session. Browser hostname checks do not resolve DNS.
 * Requests use Permissions' credential-free, redirect-refusing, timed resolver and cache;
 * Home retains only in-flight work and the set of agents admitted to this session's budget.
 * No pending lookup means undefined, allowing the hook to avoid a redundant state update.
 */
export function createIdentityResolver(publicFetch: typeof fetch = globalThis.fetch) {
  const inFlight = new Map<string, ReturnType<typeof resolveClientName>>();
  const admitted = new Set<string>();
  return (dataset: DatasetCore, subject: string | Term, userWebId?: string) => {
    const identities = new Map(identitiesIn(dataset, subject));
    for (const { iri, associated } of agentsIn(dataset, subject)) {
      if (iri === userWebId || iri === DEMO_CONNECTOR.iri || identities.has(iri)) continue;
      if (isPerson(dataset, iri)) continue;
      if (!associated && !isSoftware(dataset, iri)) continue;
      if (!publicAgentUrl(iri) || !isClientIdDocument(iri)) continue;
      const url = new URL(iri);
      if (url.hash || (!admitted.has(iri) && admitted.size >= 20)) continue;
      admitted.add(iri);
      let lookup = inFlight.get(iri);
      if (!lookup) {
        lookup = resolveClientName(iri, publicFetch).finally(() => inFlight.delete(iri));
        inFlight.set(iri, lookup);
      }
      return lookup.then((metadata) => {
        identities.set(iri, { kind: "app", label: externalName(metadata.name, url.hostname) });
        return identities;
      });
    }
    return undefined;
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
];

/**
 * One software-type predicate. Labels may also treat an ActivityStreams Service as an app;
 * client-name lookup never does, because a Service is not a Solid-OIDC client.
 */
function isSoftware(
  dataset: DatasetCore,
  iri: string,
  { includeService = false }: { includeService?: boolean } = {},
): boolean {
  return subjectOf(dataset, iri).types.some(
    (type) =>
      SOFTWARE_TYPES.includes(type) ||
      (includeService && type === "https://www.w3.org/ns/activitystreams#Service"),
  );
}
/**
 * What the loaded graph says an attributed agent is, without fetching its profile: a person
 * only when typed as one, an app when typed as software (an AI agent included). An IRI's
 * shape proves nothing: an AI agent's WebID (`…/agent#me`) looks just like a person's.
 */
function typedAgent(dataset: DatasetCore, iri: string): "person" | "app" | undefined {
  if (isPerson(dataset, iri)) return "person";
  if (isSoftware(dataset, iri, { includeService: true })) return "app";
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
  for (const { iri, generated, associated } of agentsIn(dataset, subject)) {
    if (iri === context.userWebId || (demo && iri === DEMO_CONNECTOR.iri)) continue;
    attributedToAnother = true;
    const identity = context.identities?.get(iri);
    const typed = typedAgent(dataset, iri);
    const url = httpUrl(iri);
    // A person's WebID is labelled with that profile's name, never as an app.
    if (identity)
      return {
        kind: identity.kind,
        label: externalName(identity.label, url?.hostname ?? "someone else"),
      };
    if (typed === "person") attributedToPerson = true;
    else if (url && (typed === "app" || associated)) return { kind: "app", label: url.hostname };
    else if (!generated && typed === undefined && url) attributedToSomeone = true;
  }
  // Folder attribution uses the same exact connector import roots as the demo marker.
  const storage = context.storage;
  if (storage && inStorage(storage, storage)) {
    const connector = CONNECTORS.find((connector) =>
      inStorage(containerUrl, adapterContainerUrl(storage, connector.id)),
    );
    if (connector) return providedBy(connector);
  }
  if (attributedToPerson) return { kind: "person", label: "another person" };
  if (attributedToSomeone) return { kind: "other", label: "someone else" };
  return attributedToAnother
    ? { kind: "app", label: "another app" }
    : { kind: "you", label: "Added by you" };
}
