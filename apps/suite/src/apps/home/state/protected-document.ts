// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { classifySubject } from "../lib/model/classify";
import type { DomainItem } from "../lib/model/discovery";
import { inStorage, readResource, subjectOf } from "../lib/model/rdf";
import type { HomeSession } from "./use-domain-items";

const SPACE = "http://www.w3.org/ns/pim/space#";
/** Account infrastructure: removing one of these documents breaks sign-in or discovery. */
const INFRASTRUCTURE_TYPES = new Set([
  `${NS.SOLID}TypeIndex`,
  `${NS.SOLID}TypeRegistration`,
  `${NS.SOLID}StorageDescription`,
  `${SPACE}Storage`,
  `${SPACE}ConfigurationFile`,
]);
/** Statements that only a profile, preferences file or storage description carries. */
const INFRASTRUCTURE_PREDICATES = new Set([
  `${NS.SOLID}oidcIssuer`,
  `${NS.SOLID}privateTypeIndex`,
  `${NS.SOLID}publicTypeIndex`,
  `${SPACE}preferencesFile`,
  `${SPACE}storage`,
]);
/** The links a WebID profile uses to reach its settings. */
const PROFILE_LINKS = [
  `${NS.SOLID}publicTypeIndex`,
  `${NS.SOLID}privateTypeIndex`,
  `${SPACE}preferencesFile`,
];
const WELL_KNOWN = [
  "settings/prefs.ttl",
  "settings/privateTypeIndex.ttl",
  "settings/publicTypeIndex.ttl",
  ".well-known/solid",
];

/**
 * Whole-document deletion is never offered for shared records or account infrastructure. The WebID
 * profile backs both the Identity and Contact details cards: their fields are
 * removed through the edit form, never by deleting the profile document.
 */
export function protectedDocument(item: DomainItem, storage: string, webId?: string): boolean {
  if (webId !== undefined && item.url === webId.split("#")[0]) return true;
  // Contact details are always an aggregate of the profile's own linked nodes.
  if (item.dataType?.id === "contact-details") return true;
  if (WELL_KNOWN.some((path) => item.url === new URL(path, storage).href)) return true;
  for (const quad of item.dataset) {
    if (INFRASTRUCTURE_PREDICATES.has(quad.predicate.value)) return true;
    if (quad.predicate.value === `${NS.RDF}type` && INFRASTRUCTURE_TYPES.has(quad.object.value))
      return true;
    // DELETE removes every subject. A sibling record must survive an action on this card.
    // File cards carry their container's dataset rather than the file's own contents.
    if (
      item.dataType?.id !== "files" &&
      quad.predicate.value === `${NS.RDF}type` &&
      quad.subject.termType === "NamedNode" &&
      quad.subject.value.split("#")[0] === item.url &&
      !quad.subject.equals(item.subject) &&
      classifySubject(subjectOf(item.dataset, quad.subject), webId).dataType
    )
      return true;
  }
  return false;
}

/** HTTP Link header targets for a relation; RDF is never parsed this way. */
function linkTargets(headers: Headers, base: string, relations: readonly string[]): string[] {
  const targets: string[] = [];
  for (const part of (headers.get("link") ?? "").split(/,(?=\s*<)/)) {
    const target = /^\s*<([^>]+)>/.exec(part)?.[1];
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(part);
    const rels = (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/);
    if (target && rels.some((value) => relations.includes(value)))
      targets.push(new URL(target, base).href.split("#")[0] as string);
  }
  return targets;
}

/**
 * Infrastructure need not carry a type of its own: settings are found by the
 * profile's links, and the storage description by the storage root's Link header.
 * An external profile is read without credentials and without following redirects.
 * Any read other than "not found" fails closed by throwing.
 */
export async function linkedProtectedDocument(
  session: HomeSession,
  target: string,
): Promise<boolean> {
  const profileUrl = session.webId.split("#")[0] as string;
  if (target === profileUrl) return true;
  const profileFetch: typeof fetch = inStorage(profileUrl, session.storageUrl)
    ? session.fetch
    : (input, init) => globalThis.fetch(input, { ...init, credentials: "omit", redirect: "error" });
  try {
    const profile = await readResource(profileFetch, profileUrl);
    const owner = subjectOf(profile.dataset, session.webId);
    if (
      PROFILE_LINKS.flatMap((predicate) => owner.iris(predicate)).some(
        (url) => url.split("#")[0] === target,
      )
    )
      return true;
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
  }
  const root = await session.fetch(session.storageUrl, { method: "HEAD", redirect: "error" });
  return linkTargets(root.headers, session.storageUrl, [
    `${NS.SOLID}storageDescription`,
    "describedby",
  ]).includes(target);
}
