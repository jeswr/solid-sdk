// AUTHORED-BY Codex GPT-6
import type { DocumentLoader } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";

export const ANSWERABLE_CONTEXT = "https://w3id.org/jeswr/awp/context/v1";
export const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";
export const DI_CONTEXT = "https://w3id.org/security/data-integrity/v2";
/** The SDK's supported ODRL context, versioned here; not a copy of the full W3C context. */
export const ODRL_CONTEXT = "https://w3id.org/jeswr/awp/context/odrl/v1";

const pins = new Map([
  [
    ANSWERABLE_CONTEXT,
    ["v1.jsonld", "6e95141750f3e10532d6c9c50ac33178114ec90ad042fb8246d51b1228041ce4"],
  ],
  [
    VC_CONTEXT,
    ["credentials-v2.json", "8a9f494a89ecc51db093e90e84713e07e84d6d9204364a9b3c7868b21751236f"],
  ],
  [
    DI_CONTEXT,
    ["data-integrity-v2.json", "0f77743daf5b4e8fc067fc5ba5b21044283053aa717fc6b0219843bed3b00363"],
  ],
  [
    ODRL_CONTEXT,
    ["odrl-v1.jsonld", "1703a1b7f43667646b31e8eb9382e5eb17e08cecda8425727dd46e76202fb2c9"],
  ],
]);

export class DocumentError extends Error {
  constructor(
    readonly detail: string,
    readonly reason: "malformed" | "bounds-exceeded" = "malformed",
  ) {
    super(detail);
  }
}

/** Check the exact bundled bytes before returning a fresh copy. No transport exists here. */
export function bundledContext(iri: string): Record<string, unknown> {
  const pin = pins.get(iri);
  if (!pin) throw new DocumentError("context-not-accepted");
  const [file, expected] = pin;
  const bytes = readFileSync(new URL(`../../vocab/context/${file}`, import.meta.url));
  return readPinnedContext(bytes.toString("utf8"), expected as string);
}

/** Validate immutable context bytes before interpreting them. Used by the fixed loader only. */
export function readPinnedContext(bytes: string, expected: string): Record<string, unknown> {
  if (createHash("sha256").update(bytes, "utf8").digest("hex") !== expected)
    throw new DocumentError("context-not-accepted");
  return JSON.parse(bytes) as Record<string, unknown>;
}

export const documentLoader: DocumentLoader = {
  async load(iri) {
    return bundledContext(iri);
  },
};

/** The same pinned source for JSON-LD compaction; this adapter also never fetches. */
export async function jsonLdLoader(iri: string) {
  return { documentUrl: iri, document: bundledContext(iri) as import("jsonld").NodeObject };
}

type Definition = string | Record<string, unknown>;
type Context = Map<string, Definition>;
const keywords = new Set([
  "@context",
  "@id",
  "@type",
  "@value",
  "@language",
  "@direction",
  "@index",
  "@list",
  "@set",
  "@reverse",
  "@graph",
  "@included",
  "@nest",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function applyContext(active: Context, value: unknown): Context {
  let next = new Map(active);
  if (Array.isArray(value)) {
    for (const entry of value) next = applyContext(next, entry);
    return next;
  }
  if (typeof value === "string") return applyContext(next, bundledContext(value)["@context"]);
  if (!isObject(value)) throw new DocumentError("context-not-accepted");
  for (const [term, definition] of Object.entries(value)) {
    if (term.startsWith("@")) continue;
    if (typeof definition === "string" || isObject(definition)) next.set(term, definition);
    else next.delete(term);
  }
  return next;
}

/** Reject every context object in the document, even at a node the processor might drop. */
function checkContexts(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) checkContexts(item);
    return;
  }
  if (!isObject(value)) return;
  if ("@context" in value) {
    const contexts = Array.isArray(value["@context"]) ? value["@context"] : [value["@context"]];
    if (contexts.length === 0) throw new DocumentError("context-not-accepted");
    for (const context of contexts) {
      if (typeof context !== "string") throw new DocumentError("context-not-accepted");
      bundledContext(context);
    }
  }
  for (const [key, item] of Object.entries(value)) if (key !== "@context") checkContexts(item);
}

function checkKeys(value: unknown, inherited: Context): void {
  if (Array.isArray(value)) {
    for (const item of value) checkKeys(item, inherited);
    return;
  }
  if (!isObject(value)) return;
  let active = "@context" in value ? applyContext(inherited, value["@context"]) : inherited;
  // JSON-LD applies type-scoped contexts before processing properties, independently of key order.
  const types = Object.entries(value)
    .filter(([key]) => key === "@type" || active.get(key) === "@type")
    .flatMap(([, item]) => (Array.isArray(item) ? item : [item]));
  for (const type of types.filter((item): item is string => typeof item === "string").sort()) {
    const definition = active.get(type);
    if (isObject(definition) && definition["@context"] !== undefined)
      active = applyContext(active, definition["@context"]);
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "@context") continue;
    if (key === "@direction") throw new DocumentError("unsupported-direction");
    if (!keywords.has(key) && !active.has(key)) throw new DocumentError("undefined-term");
    const definition = active.get(key);
    if (item === null) throw new DocumentError("unrepresentable-null");
    const values = Array.isArray(item) ? item : [item];
    const iriField =
      key === "@id" ||
      definition === "@id" ||
      (isObject(definition) && definition["@type"] === "@id");
    if (iriField)
      for (const token of values) {
        if (typeof token === "string" && !token.startsWith("_:") && !isSafeAbsoluteIri(token))
          throw new DocumentError("invalid-iri");
      }
    if (isObject(definition) && definition["@type"] === "http://www.w3.org/2001/XMLSchema#decimal")
      for (const token of values) {
        if (typeof token !== "string" && !(isObject(token) && typeof token["@value"] === "string"))
          throw new DocumentError("decimal-must-be-string");
      }
    const scope = isObject(definition) ? definition["@context"] : undefined;
    const child = scope === undefined ? active : applyContext(active, scope);
    // Unmapped enumeration values can also disappear during expansion.
    if (isObject(definition) && definition["@type"] === "@vocab") {
      for (const token of Array.isArray(item) ? item : [item]) {
        if (typeof token === "string" && !child.has(token))
          throw new DocumentError("undefined-term");
      }
    }
    if (key === "@type" && item === "@json") throw new DocumentError("undefined-term");
    checkKeys(item, child);
  }
}

/** Context and key admission always runs before signature verification or RDF conversion. */
export function checkDocumentTerms(document: unknown): asserts document is Record<string, unknown> {
  if (!isObject(document)) throw new DocumentError("document-must-be-an-object");
  checkContexts(document);
  if (!("@context" in document)) throw new DocumentError("context-not-accepted");
  checkKeys(document, new Map());
}
