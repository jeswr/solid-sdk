// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-5
/** Public scene API over the generated drawing model; the canvas remains opaque. */
import { isSafeAbsoluteIri, isXsdDateTime, literalMapper, tryRead } from "@jeswr/model-runtime";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore, NamedNode, DataFactory as RdfDataFactory, Term } from "@rdfjs/types";
import { LiteralAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, type Quad, type Store } from "n3";
import model, { entities, type SceneData as GeneratedSceneData } from "./generated/model.js";
import { safeHttpIri, safeSubjectBaseIri } from "./iri.js";
import { PREFIXES, XSD_DATE_TIME } from "./vocab.js";

const scene = entities.Scene;
const sceneManifest = model.manifest.entities.find((entity) => entity.name === scene.name);
if (sceneManifest === undefined || sceneManifest.kind === "composite") {
  throw new TypeError("Expected a flat Scene entity in the generated drawing model");
}
const sceneFields = sceneManifest.fields;
const { namedNode } = DataFactory;
// The generic mapper erases its input type; xsd:dateTime's writer accepts Dates.
const timestampFrom = literalMapper(XSD_DATE_TIME.value).from as (
  value: Date,
  factory: RdfDataFactory,
) => Term;
const hasTimestampZone = (value: string): boolean => /(?:Z|[+-]\d{2}:\d{2})$/.test(value);

/** Scene descriptor data; timestamp strings are the public adapter over generated Dates. */
export interface SceneData extends Omit<GeneratedSceneData, "created" | "modified"> {
  /** Creation time, serialized as xsd:dateTime. */
  created?: string;
  /** Last-modified time, serialized as xsd:dateTime. */
  modified?: string;
}

/** Preserve lexical escaping and the required http(s) subject policy in iri.ts. */
function sceneBase(resourceUrl: string): string {
  const base = safeSubjectBaseIri(resourceUrl);
  if (base === undefined) throw new TypeError("resourceUrl must be a valid absolute http(s) IRI");
  return base;
}

/** The conventional scene subject, with the existing required-subject guard. */
export function sceneSubject(resourceUrl: string): NamedNode {
  return namedNode(scene.subject(sceneBase(resourceUrl)));
}

/** Validate XSD timestamps and interpret absent zones as UTC, independent of the host. */
function date(value: string | undefined): Date | undefined {
  if (typeof value !== "string" || !isXsdDateTime(value)) return undefined;
  // XSD expanded/negative years need ECMAScript's signed six-digit spelling.
  const yearEnd = value.indexOf("-", value.startsWith("-") ? 1 : 0);
  const year = Number(value.slice(0, yearEnd));
  if (!Number.isSafeInteger(year) || Math.abs(year) > 275760 || Object.is(year, -0)) {
    return undefined;
  }
  const jsYear =
    year < 0 || year > 9999
      ? `${year < 0 ? "-" : "+"}${String(Math.abs(year)).padStart(6, "0")}`
      : String(year).padStart(4, "0");
  const lexical = jsYear + value.slice(yearEnd);
  const parsed = new Date(hasTimestampZone(value) ? lexical : `${lexical}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/**
 * SHACL cannot express lexical escaping or the public required-link throw policy.
 * Keep those here; omit scheme guards in config to preserve exact RDF IRI identity.
 */
function generatedData(data: SceneData): GeneratedSceneData {
  const sceneDocument = safeHttpIri(data.sceneDocument);
  if (!isSafeAbsoluteIri(sceneDocument))
    throw new TypeError("sceneDocument must be a safe http(s) IRI");
  return {
    ...data,
    sceneDocument,
    thumbnail: safeHttpIri(data.thumbnail),
    about: safeHttpIri(data.about),
    wasGeneratedBy: safeHttpIri(data.wasGeneratedBy),
    created: date(data.created),
    modified: date(data.modified),
  };
}

/** Build all scene fields through the generated entity and its datatype guards. */
export function buildScene(resourceUrl: string, data: SceneData): Store {
  return scene.build(sceneBase(resourceUrl), generatedData(data));
}

/** Preserve generic Store serialization, including unrelated and legacy terms. */
export function storeToTurtle(store: Store): Promise<string> {
  return serialize([...store], {
    format: "text/turtle",
    prefixes: { ...PREFIXES },
    emptyAsEmptyString: false,
  });
}

/** Invalid required inputs reject the returned promise, as in the original API. */
export async function serializeScene(resourceUrl: string, data: SceneData): Promise<string> {
  return scene.serialize(sceneBase(resourceUrl), generatedData(data));
}

/**
 * The drawing oracle counts singleton values across aliases, whereas runtime aliases
 * prefer canonical values. Alias IRIs and fields come from generated metadata.
 */
export function parseScene(resourceUrl: string, dataset: DatasetCore): SceneData | undefined {
  const subject = sceneSubject(resourceUrl);
  const conflicts: (keyof SceneData)[] = [];
  const carried: Partial<Pick<SceneData, "schemaVersion" | "viewBackgroundColor">> = {};
  const zoneless: Partial<Pick<SceneData, "created" | "modified">> = {};
  const view = new TermWrapper(subject, dataset, DataFactory);
  for (const field of sceneFields) {
    let object: Term | undefined;
    for (const predicate of [field.predicate, ...(field.aliasPredicates ?? [])]) {
      const matches = dataset.match(subject, namedNode(predicate));
      for (const q of matches) {
        if (matches.size > 1 || (object !== undefined && !object.equals(q.object))) {
          if (field.guards?.requiredFailClosed) return undefined;
          conflicts.push(field.name as keyof SceneData);
        }
        object = q.object;
      }
    }
    // Closed admission requires a datatype. The published model allows ANY literal
    // for these two fields; retain its lexical read through this minimal typed view.
    if (
      (field.name === "schemaVersion" || field.name === "viewBackgroundColor") &&
      object?.termType === "Literal"
    ) {
      for (const predicate of [field.predicate, ...(field.aliasPredicates ?? [])]) {
        carried[field.name] ??= tryRead(() =>
          OptionalFrom.subjectPredicate(view, predicate, LiteralAs.string),
        );
      }
    }
    if (
      (field.name === "created" || field.name === "modified") &&
      object?.termType === "Literal" &&
      object.datatype.equals(XSD_DATE_TIME)
    ) {
      const lexical = tryRead(() =>
        OptionalFrom.subjectPredicate(view, field.predicate, LiteralAs.string),
      );
      if (lexical !== undefined && !hasTimestampZone(lexical)) zoneless[field.name] = lexical;
    }
  }
  const core = scene.parse(sceneBase(resourceUrl), dataset);
  if (core === undefined) return undefined;
  // Keep optional keys absent and timestamps as strings in the public API.
  const { created, modified, ...fields } = core;
  const data: SceneData = { ...fields };
  for (const key of ["schemaVersion", "viewBackgroundColor"] as const) {
    if (data[key] === undefined && carried[key] !== undefined) data[key] = carried[key];
  }
  for (const [key, value] of [
    ["created", created],
    ["modified", modified],
  ] as const) {
    // The runtime Date used local time for zoneless literals; re-read their lexical value.
    const parsed = zoneless[key] === undefined ? value : date(zoneless[key]);
    if (parsed !== undefined) data[key] = timestampFrom(parsed, DataFactory).value;
  }
  for (const key of conflicts) delete data[key];
  return data;
}

/** Parse through fetch-rdf, including null Content-Type's existing Turtle default. */
export async function parseSceneTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<SceneData | undefined> {
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, contentType ?? "text/turtle", { baseIRI: url });
  return parseScene(url, dataset);
}

export type { Quad };
