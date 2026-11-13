// AUTHORED-BY Codex GPT-6
import { type DatasetCore, parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { digestQuads } from "@jeswr/solid-vc";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import jsonld from "jsonld";
import { DataFactory, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { BoundsError, DEFAULT_LIMITS, type PilotLimits, parseBoundedJson } from "../core/limits.js";
import { MESSAGE_KINDS } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import {
  ANSWERABLE_CONTEXT,
  checkDocumentTerms,
  DocumentError,
  documentLoader,
  jsonLdLoader,
} from "./contexts.js";

export interface DocumentNode {
  readonly dataset: DatasetCore;
  readonly id?: string;
  readonly value?: string;
}
export type Refusal = {
  readonly ok: false;
  readonly reason: "malformed" | "bounds-exceeded" | "bad-signature" | "unknown-key";
  readonly detail: string;
};
export type ReadResult =
  | { readonly ok: true; readonly dataset: Store; readonly root: string }
  | Refusal;
export type JsonLdDocument = Record<string, unknown>;
const { namedNode } = DataFactory;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const messageTypes = MESSAGE_KINDS.map((kind) => AWP + kind[0]?.toUpperCase() + kind.slice(1));
let shapesPromise: Promise<Store> | undefined;
function shapes(): Promise<Store> {
  shapesPromise ??= parseRdf(
    readFileSync(new URL("../../vocab/answerable.shacl.ttl", import.meta.url), "utf8"),
    "text/turtle",
  );
  return shapesPromise;
}

export function refusal(error: unknown): Refusal {
  if (error instanceof DocumentError)
    return { ok: false, reason: error.reason, detail: error.detail };
  if (error instanceof BoundsError)
    return {
      ok: false,
      reason: error.code === "not-json" ? "malformed" : "bounds-exceeded",
      detail: error.code,
    };
  return { ok: false, reason: "malformed", detail: "invalid-rdf-document" };
}

export function readJson(
  bytes: string | Uint8Array,
  limits: PilotLimits = DEFAULT_LIMITS,
): JsonLdDocument {
  const text =
    typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = parseBoundedJson(text, limits);
  assertUniqueKeys(text);
  checkDocumentTerms(document);
  return document;
}

/** RFC 8785/I-JSON forbids duplicate member names, including differently escaped spellings. */
export function assertUniqueKeys(text: string): void {
  const stack: Array<{ object: boolean; key: boolean; names: Set<string> }> = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      const frame = stack.at(-1);
      if (frame?.object && frame.key) {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (frame.names.has(key)) throw new DocumentError("duplicate-key");
        frame.names.add(key);
        frame.key = false;
      }
    } else if (char === "{" || char === "[")
      stack.push({ object: char === "{", key: char === "{", names: new Set() });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.object) {
      const frame = stack.at(-1);
      if (frame) frame.key = true;
    }
  }
}

/** Hard cap before any RDFC operation, counting distinct blank nodes in every position. */
export function assertBlankNodeLimit(dataset: Store): void {
  const nodes = new Set<string>();
  for (const quad of dataset)
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
      if (term.termType === "BlankNode") nodes.add(term.value);
      if (nodes.size > 64) throw new DocumentError("too-many-blank-nodes");
    }
}

export async function documentDataset(
  document: JsonLdDocument,
  limits: PilotLimits = DEFAULT_LIMITS,
): Promise<Store> {
  document = readJson(JSON.stringify(document), limits);
  // The workspace streaming parser incorrectly treats repeated protected type-scoped
  // contexts as redefinitions when inherited at nested nodes. Expand with the standard
  // JSON-LD processor, then use the SDK's parser on the context-free expanded document.
  // Original byte/depth/node limits have already run; expansion has separate finite caps.
  const expanded = await jsonld.expand(document as import("jsonld").NodeObject, {
    documentLoader: jsonLdLoader,
  });
  return parseRdf(JSON.stringify(expanded), "application/ld+json", {
    documentLoader,
    maxBytes: limits.maxEnvelopeBytes * 16,
    maxJsonDepth: limits.maxJsonDepth * 2 + 4,
    maxQuads: limits.maxJsonNodes * 4,
  });
}

async function validateRoot(dataset: Store, root: string): Promise<void> {
  const types = dataset
    .getObjects(namedNode(root), namedNode(RDF_TYPE), null)
    .map((node) => node.value);
  const kinds = types.filter((type) => messageTypes.includes(type));
  if (kinds.length > 1) throw new DocumentError(`shape=${AWP}MessageShape;path=${RDF_TYPE}`);
  if (types.includes(AWP + "Message") && kinds.length === 0)
    throw new DocumentError(`shape=${AWP}MessageShape;path=${RDF_TYPE}`);
  const shapeGraph = await shapes();
  const modeledTypes = new Set(
    shapeGraph
      .getObjects(null, namedNode("http://www.w3.org/ns/shacl#targetClass"), null)
      .map((node) => node.value),
  );
  const required =
    kinds.length === 1
      ? [AWP + "Message", ...kinds]
      : types.filter((type) => modeledTypes.has(type) && type !== AWP + "Message");
  if (required.length === 0) throw new DocumentError(`shape=${AWP}MessageShape;path=${RDF_TYPE}`);
  const validator = new SHACLValidator(shapeGraph, { maxErrors: 8 });
  for (const type of required) {
    const targets = shapeGraph.getSubjects(
      namedNode("http://www.w3.org/ns/shacl#targetClass"),
      namedNode(type),
      null,
    );
    for (const shape of targets) {
      const report = await validator.validateNode(dataset, namedNode(root), shape);
      if (!report.conforms) {
        const result = report.results[0];
        throw new DocumentError(`shape=${shape.value};path=${result?.path?.value ?? RDF_TYPE}`);
      }
    }
  }
}

/** The sole public bytes-to-dataset boundary. No remote I/O and no object leaves it. */
export async function readDocument(
  bytes: string | Uint8Array,
  mediaType: string,
  options: { limits?: PilotLimits; suite?: "jws" | "data-integrity" } = {},
): Promise<ReadResult> {
  try {
    const limits = options.limits ?? DEFAULT_LIMITS;
    if (Buffer.byteLength(bytes) > limits.maxEnvelopeBytes)
      throw new DocumentError("too-large", "bounds-exceeded");
    const format = mediaType.split(";")[0]?.trim().toLowerCase();
    if (format !== "application/ld+json") throw new DocumentError("unsupported-media-type");
    const document = readJson(bytes, limits);
    const id = document.id ?? document["@id"];
    if (
      typeof id !== "string" ||
      !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i.test(id) ||
      id.startsWith("_:") ||
      id.length > 512
    )
      throw new DocumentError(`shape=${AWP}MessageShape;path=@id`);
    const dataset = await documentDataset(document, limits);
    if (options.suite === "data-integrity") assertBlankNodeLimit(dataset);
    await validateRoot(dataset, id);
    return { ok: true, dataset, root: id };
  } catch (error) {
    return refusal(error);
  }
}

const order = [
  "@context",
  "id",
  "type",
  "profile",
  "configuration",
  "kind",
  "conversation",
  "from",
  "to",
  "createdAt",
  "expiresAt",
  "inReplyTo",
  "body",
  "evidence",
  "content",
  "proof",
];
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => {
        const ai = order.indexOf(a),
          bi = order.indexOf(b);
        return (
          (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b, "en")
        );
      })
      .map(([key, item]) => [key, stable(item)]),
  );
}

/** Compact the exact graph, retaining all nodes. Refuse a projection that loses triples. */
export async function writeDocument(
  node: DocumentNode,
  options: { limits?: PilotLimits } = {},
): Promise<JsonLdDocument> {
  const id = node.id ?? node.value;
  if (
    typeof id !== "string" ||
    !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i.test(id) ||
    id.startsWith("_:")
  )
    throw new DocumentError("invalid-root-iri");
  const dataset = new Store([...node.dataset]);
  const expanded = JSON.parse(await serialize([...dataset], { format: "application/ld+json" }));
  const compacted = await jsonld.compact(
    expanded,
    ANSWERABLE_CONTEXT as unknown as NonNullable<Parameters<typeof jsonld.compact>[1]>,
    { documentLoader: jsonLdLoader, compactArrays: true },
  );
  // Framing reconnects the root to embedded nodes while retaining named proof graphs.
  const frameOptions = { documentLoader: jsonLdLoader, omitGraph: true };
  const hasProof =
    dataset.countQuads(namedNode(id), namedNode("https://w3id.org/security#proof"), null, null) > 0;
  const frame = {
    "@context": ANSWERABLE_CONTEXT,
    "@id": id,
    "@embed": "@always",
    ...(hasProof ? { proof: { "@graph": {} } } : {}),
  };
  // Complete domain values and embedded proof graphs may exceed the nesting bound
  // when recursively framed. Keep their named nodes flat in one JSON-LD document.
  // @included retains every node and named graph without inventing a second graph.
  const flatModel =
    ["NamedValueCollection", "EvidenceItem"].some(
      (type) => dataset.countQuads(null, namedNode(RDF_TYPE), namedNode(AWP + type), null) > 0,
    ) ||
    dataset.countQuads(null, namedNode(RDF_TYPE), namedNode("https://schema.org/ItemList"), null) >
      0;
  let framed: unknown;
  if (flatModel) {
    const nodes = (compacted["@graph"] ?? [compacted]) as JsonLdDocument[];
    const root = nodes.find((entry) => (entry.id ?? entry["@id"]) === id);
    if (!root) throw new DocumentError("missing-root-on-write");
    framed = {
      "@context": ANSWERABLE_CONTEXT,
      ...root,
      "@included": nodes.filter((entry) => entry !== root),
    };
  } else framed = await jsonld.frame(compacted, frame, frameOptions);
  const document = stable(framed) as JsonLdDocument;
  checkDocumentTerms(document);
  const roundTrip = await documentDataset(document, options.limits);
  assertBlankNodeLimit(dataset);
  assertBlankNodeLimit(roundTrip);
  if ((await digestQuads([...dataset])) !== (await digestQuads([...roundTrip])))
    throw new DocumentError("graph-loss-on-write");
  return document;
}

export async function toTurtle(dataset: Store): Promise<string> {
  if (dataset.getGraphs(null, null, null).some((graph) => graph.termType !== "DefaultGraph"))
    throw new DocumentError("named-graphs-require-trig");
  return serialize([...dataset], {
    format: "text/turtle",
    prefixes: {
      awp: AWP,
      vc: "https://www.w3.org/2018/credentials#",
      prov: "http://www.w3.org/ns/prov#",
      odrl: "http://www.w3.org/ns/odrl/2/",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
  });
}

export async function toTrig(dataset: Store): Promise<string> {
  return serialize([...dataset], {
    format: "application/trig",
    prefixes: {
      awp: AWP,
      vc: "https://www.w3.org/2018/credentials#",
      sec: "https://w3id.org/security#",
    },
  });
}
