// AUTHORED-BY Claude Sonnet 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { StorageError } from "@jeswr/storage-client";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { ACL, ACP, parent, RDF } from "./rdf.js";
import { boundedBody, scoped } from "./roles/http.js";
import type { AccessClientOptions } from "./types.js";

type Storage = AccessClientOptions["storage"];
type Head = Awaited<ReturnType<Storage["head"]>>;

const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";
const STRONG_OR_WEAK_ETAG = /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/;
const MODE_NAMES = ["Read", "Write", "Append", "Control"];
/** The vocabulary a standard mode IRI belongs to, by exact string comparison. */
const modeVocabulary = (value: string) =>
  [ACL, ACP].find((vocabulary) => MODE_NAMES.some((name) => value === vocabulary + name));
const MAX_ANCESTORS = 64;
const MAX_QUADS = 10_000;

/** Why the access-control model could not be decided. Never carries URLs, text or server messages. */
export type UndecidedReason =
  | "unsupported-protocol"
  | "no-wac-evidence"
  | "out-of-scope"
  | "no-permission"
  | "unreadable"
  | "no-access-link"
  | "ambiguous-link"
  | "no-access-document"
  | "invalid-document"
  | "mixed-models"
  | "unrecognised-document"
  | "ambiguous-dialect";

/** Closed result of {@link detectAccessControl}. `accessDocument` is the document whose vocabulary decided the model. */
export type DetectedAccessControl =
  | { model: "wac"; accessDocument: string }
  | { model: "acp"; dialect: "css" | "ess"; accessDocument: string }
  | { model: "undecided"; reason: UndecidedReason };

/** The error `checkOwnerOnly` throws for a conflicting explicit option; see {@link isOwnerOnlyConflictError}. */
export interface OwnerOnlyConflict extends Error {
  readonly name: "OwnerOnlyConflictError";
  readonly aspect: "model" | "dialect";
  readonly explicit: string;
  readonly shown: string;
}

// A plain Error branded privately (like PolicyTooComplex): the package exports no class
// whose prototype a caller could mutate, and the brand cannot be forged by name.
const conflicts = new WeakSet<object>();

/**
 * Thrown by `checkOwnerOnly` when an explicitly supplied `accessModel` or `acpDialect`
 * contradicts what the access document (or its link relation) itself shows. It is never resolved
 * silently in favour of either side; the message carries no document text.
 */
export function ownerOnlyConflict(
  aspect: "model" | "dialect",
  explicit: string,
  shown: string,
): OwnerOnlyConflict {
  const error = new Error(
    `Explicit ${aspect} "${explicit}" conflicts with what the pod shows ("${shown}")`,
  ) as Error & { -readonly [K in keyof OwnerOnlyConflict]: OwnerOnlyConflict[K] };
  error.name = "OwnerOnlyConflictError";
  error.aspect = aspect;
  error.explicit = explicit;
  error.shown = shown;
  conflicts.add(error);
  return error;
}

/** Identify the conflict error `checkOwnerOnly` throws. */
export function isOwnerOnlyConflictError(error: unknown): error is OwnerOnlyConflict {
  return typeof error === "object" && error !== null && conflicts.has(error);
}

/** Server-side evidence of WAC enforcement: the resource's HEAD carried a well-formed WAC-Allow header (presence only; its contents are never trusted). */
export const hasWacEvidence = (head: Head) => Boolean(head.allow);

/** The one access document a resource advertises, or why none can be used. */
export function locate(
  head: Head,
  storage: Storage,
  root: string,
):
  | { endpoint: string; acpLink: boolean }
  | { problem: "no-access-link" | "ambiguous-link" | "out-of-scope" } {
  const acpLink = head.links.has(`${ACP}accessControl`);
  const endpoints = [
    ...new Set(
      [...(head.links.get("acl") ?? []), ...(head.links.get(`${ACP}accessControl`) ?? [])].map(
        (link) => link.target,
      ),
    ),
  ];
  if (endpoints.length === 0) return { problem: "no-access-link" };
  if (endpoints.length > 1) return { problem: "ambiguous-link" };
  try {
    const endpoint = scoped(endpoints[0] as string, root, true);
    if (storage.isWithinStorage(endpoint)) return { endpoint, acpLink };
  } catch {
    // Off-origin, out-of-root or non-canonical.
  }
  return { problem: "out-of-scope" };
}

/**
 * Revalidate then read one access document through the storage view: a strong or weak validator
 * must bind the body, the body is drained through the 1 MiB cap and parsed with `@jeswr/fetch-rdf`
 * (at most 10,000 quads). `undefined` only when a revalidated HEAD is 404; every other failure
 * throws, and a GET failure after an existing HEAD is never absence.
 */
export async function loadAccessDocument(
  storage: Storage,
  endpoint: string,
): Promise<{ dataset: DatasetCore } | undefined> {
  let head: Head;
  try {
    head = await storage.head(endpoint, { revalidate: true });
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) return undefined;
    throw error;
  }
  if (
    head.url !== endpoint ||
    head.status !== 200 ||
    head.etag === null ||
    !STRONG_OR_WEAK_ETAG.test(head.etag)
  )
    throw new TypeError("Unusable access document");
  const read = await storage.read(endpoint, { accept: RDF_ACCEPT });
  const text = await boundedBody(read, endpoint);
  if (
    read.url !== endpoint ||
    read.status !== 200 ||
    read.etag !== head.etag ||
    read.contentType === null
  )
    throw new TypeError("Unusable access document");
  const dataset = await parseRdf(text, read.contentType, {
    baseIRI: endpoint,
    maxQuads: MAX_QUADS,
  });
  return { dataset };
}

/**
 * Which access-control vocabulary the document shows: WAC authorizations, ACP terms (or an ACP
 * access-control link relation), both, or neither. Content only; never a host name or URL shape.
 */
export function shownModel(
  dataset: DatasetCore,
  acpLink: boolean,
): "wac" | "acp" | "mixed" | "none" {
  const acp =
    acpLink ||
    [...dataset].some(
      (q) =>
        q.predicate.value.startsWith(ACP) ||
        (q.object.termType === "NamedNode" && q.object.value.startsWith(ACP)),
    );
  const wac =
    dataset.match(
      null,
      DataFactory.namedNode(`${RDF}type`),
      DataFactory.namedNode(`${ACL}Authorization`),
    ).size > 0;
  if (acp && wac) return "mixed";
  return acp ? "acp" : wac ? "wac" : "none";
}

/**
 * The ACP dialect the document's modes show: CSS grants with acl:* modes, ESS with acp:* modes.
 * No modes, or both vocabularies, show nothing (`undefined`).
 */
export function shownDialect(dataset: DatasetCore): "css" | "ess" | undefined {
  let css = false;
  let ess = false;
  for (const predicate of ["allow", "deny"])
    for (const q of dataset.match(null, DataFactory.namedNode(`${ACP}${predicate}`))) {
      const vocabulary = modeVocabulary(q.object.value);
      if (vocabulary === ACP) ess = true;
      if (vocabulary === ACL) css = true;
    }
  if (css === ess) return undefined;
  return css ? "css" : "ess";
}

/**
 * Determine the access-control model, and for ACP the dialect, for `url` from the resource's
 * access-control link relation and the access document it names, walking to the nearest
 * ancestor access document when the resource has none (an absent WAC ACL is inherited; an
 * absent ACP access control resource is not). Every read goes through the storage view's
 * bounded, redirect-refusing, scope-checked HEAD/read. It never guesses from host names or URL
 * shapes, and decides WAC only when the resource's HEAD carried a WAC-Allow header and never throws: anything it cannot establish is `undecided` with a reason, a 401/403
 * as `no-permission`.
 */
export async function detectAccessControl(options: {
  storage: Storage;
  url: string;
}): Promise<DetectedAccessControl> {
  const { storage, url } = options;
  let evidence = false;
  const undecided = (reason: UndecidedReason): DetectedAccessControl => ({
    model: "undecided",
    reason,
  });
  try {
    if (storage.protocol !== "solid") return undecided("unsupported-protocol");
    const root = storage.root;
    try {
      scoped(root, root);
      scoped(url, root);
    } catch {
      return undecided("out-of-scope");
    }
    let current: string | undefined = url;
    for (let depth = 0; current !== undefined && depth < MAX_ANCESTORS; depth++) {
      const head = await storage.head(current, { revalidate: true });
      if (head.url !== current || head.status !== 200) return undecided("unreadable");
      if (current === url) evidence = hasWacEvidence(head);
      const found = locate(head, storage, root);
      if ("problem" in found) return undecided(found.problem);
      const document = await loadAccessDocument(storage, found.endpoint);
      if (!document) {
        if (found.acpLink) return undecided("no-access-document");
        current = parent(current, root);
        continue;
      }
      const shown = shownModel(document.dataset, found.acpLink);
      if (shown === "mixed") return undecided("mixed-models");
      if (shown === "none") return undecided("unrecognised-document");
      // A document's vocabulary shows what someone wrote, not what the server enforces: an
      // ACP server advertises its ACRs with rel="acl" too. WAC needs the server's own say-so.
      if (shown === "wac" && !evidence) return undecided("no-wac-evidence");
      if (shown === "wac") return { model: "wac", accessDocument: found.endpoint };
      const dialect = shownDialect(document.dataset);
      if (!dialect) return undecided("ambiguous-dialect");
      return { model: "acp", dialect, accessDocument: found.endpoint };
    }
    return undecided("no-access-document");
  } catch (error) {
    if (error instanceof StorageError)
      return undecided([401, 403].includes(error.status ?? 0) ? "no-permission" : "unreadable");
    return undecided("invalid-document");
  }
}
