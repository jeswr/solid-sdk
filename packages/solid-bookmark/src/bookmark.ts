// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-5
/** Public bookmark API over the ontology/SHACL-generated model. */
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore, Literal } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { type BookmarkData, type BookmarkWrapper, entities } from "./generated/model.js";
import {
  BOOK_ARCHIVED,
  BOOK_NOTES,
  DCT_CREATED,
  DCT_DESCRIPTION,
  DCT_MODIFIED,
  DCT_TITLE,
  LEGACY_BOOK_NS,
  PREFIXES,
  RDF_TYPE,
  SCHEMA_KEYWORDS,
  SCHEMA_URL,
} from "./vocab.js";

export { isHttpIri } from "./iri.js";
export type { BookmarkData };

const bm = entities.Bookmark;

// The runtime installs every accessor. Preserve explicit undefined writes even when
// consumers enable exactOptionalPropertyTypes (generated optional properties forbid them).
type Clearable = "url" | "title" | "description" | "notes" | "created" | "modified";
type ClearableFields = { [Key in Clearable]: BookmarkWrapper[Key] };
interface PublicWrapper
  extends TermWrapper,
    Omit<BookmarkWrapper, Clearable | "mark">,
    ClearableFields {
  mark(): this;
}
const Wrapper = bm.Wrapper as new (
  ...args: ConstructorParameters<typeof bm.Wrapper>
) => PublicWrapper;

/** Typed bookmark accessor; field guards and legacy aliases live in the runtime. */
export class Bookmark extends Wrapper {
  get isBookmark(): boolean {
    return this.isInstance;
  }

  /** Keep the public boolean getter and the clearing setter's wider input type. */
  override get archived(): boolean {
    return super.archived ?? false;
  }
  override set archived(value: boolean | undefined) {
    super.archived = value;
  }
}

/** The conventional `${resourceUrl}#it` subject. */
export function bookmarkSubject(resourceUrl: string): string {
  return bm.subject(resourceUrl);
}

/** Build through the generated guards; invalid required values leave a typed shell. */
export function buildBookmark(resourceUrl: string, data: BookmarkData): Store {
  const store = bm.build(resourceUrl, data);
  // Keep the public Store iteration and Turtle property order from the original writer.
  const order = [
    RDF_TYPE,
    SCHEMA_URL,
    DCT_TITLE,
    DCT_DESCRIPTION,
    BOOK_NOTES,
    BOOK_ARCHIVED,
    DCT_CREATED,
    DCT_MODIFIED,
    SCHEMA_KEYWORDS,
  ];
  const rank = new Map(order.map((predicate, index) => [predicate, index]));
  return new Store(
    [...store].sort(
      (left, right) =>
        (rank.get(left.predicate.value) ?? order.length) -
        (rank.get(right.predicate.value) ?? order.length),
    ),
  );
}

/** Preserve the public generic Store serializer, including existing legacy triples. */
export function storeToTurtle(store: Store): Promise<string> {
  return serialize([...store], {
    format: "text/turtle",
    prefixes: { ...PREFIXES },
    emptyAsEmptyString: false,
  });
}

export function serializeBookmark(resourceUrl: string, data: BookmarkData): Promise<string> {
  return storeToTurtle(buildBookmark(resourceUrl, data));
}

/** Keep JSON projections byte-compatible with the original field insertion order. */
function publicData(data: BookmarkData | undefined): BookmarkData | undefined {
  if (data === undefined) return undefined;
  return {
    url: data.url,
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(data.notes === undefined ? {} : { notes: data.notes }),
    archived: data.archived ?? false,
    ...(data.created === undefined ? {} : { created: data.created }),
    ...(data.modified === undefined ? {} : { modified: data.modified }),
    ...(data.tags === undefined ? {} : { tags: [...data.tags].sort() }),
  };
}

/** The literal objects of `subject predicate ?o`, in dataset order. */
function literals(dataset: DatasetCore, subject: string, predicate: string): Literal[] {
  const found: Literal[] = [];
  for (const quad of dataset.match(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(predicate),
  )) {
    if (quad.object.termType === "Literal") found.push(quad.object);
  }
  return found;
}

function firstText(
  dataset: DatasetCore,
  subject: string,
  predicates: string[],
): string | undefined {
  for (const predicate of predicates) {
    const [first] = literals(dataset, subject, predicate);
    if (first !== undefined) return first.value;
  }
  return undefined;
}

/** An `xsd:date` lexical form with its optional timezone (`2025-03-04`, `2025-03-04+00:00`). */
const XSD_DATE = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})?$/;

function firstDate(dataset: DatasetCore, subject: string, predicate: string): Date | undefined {
  const [first] = literals(dataset, subject, predicate);
  if (first === undefined) return undefined;
  // `new Date` rejects a timezone-qualified date-only value, so give it midnight in that zone.
  const dateOnly = XSD_DATE.exec(first.value);
  const lexical = dateOnly ? `${dateOnly[1]}T00:00:00${dateOnly[2] ?? "Z"}` : first.value;
  const date = new Date(lexical);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Keep values the SHACL profile does not admit (language-tagged or non-string text, an
 * `xsd:date` created value, a second title) so a plain-data parse → edit → serialize
 * round-trip never silently deletes them or re-stamps `created`. For a field the
 * profile projection omits, this applies the hand-written package's read: the first
 * literal's lexical value (dates parsed as before), and every literal keyword. Whether
 * the profile itself should widen is a normative decision (sst-ild.7.7).
 */
function carryUnprofiled(
  resourceUrl: string,
  dataset: DatasetCore,
  data: BookmarkData | undefined,
): BookmarkData | undefined {
  if (data === undefined) return undefined;
  const subject = bookmarkSubject(resourceUrl);
  const carried: BookmarkData = { ...data };
  carried.title ??= firstText(dataset, subject, [DCT_TITLE]);
  carried.description ??= firstText(dataset, subject, [DCT_DESCRIPTION]);
  carried.notes ??= firstText(dataset, subject, [BOOK_NOTES, `${LEGACY_BOOK_NS}notes`]);
  carried.created ??= firstDate(dataset, subject, DCT_CREATED);
  carried.modified ??= firstDate(dataset, subject, DCT_MODIFIED);
  const tags = new Set(data.tags ?? []);
  for (const keyword of literals(dataset, subject, SCHEMA_KEYWORDS)) tags.add(keyword.value);
  if (tags.size > 0) carried.tags = [...tags];
  for (const key of ["title", "description", "notes", "created", "modified"] as const) {
    if (carried[key] === undefined) delete carried[key];
  }
  return carried;
}

/** Fail closed on a missing/invalid URL; omit absent optional fields. */
export function parseBookmark(resourceUrl: string, dataset: DatasetCore): BookmarkData | undefined {
  return publicData(carryUnprofiled(resourceUrl, dataset, bm.parse(resourceUrl, dataset)));
}

/** Parse via fetch-rdf, defaulting an absent/null Content-Type to Turtle. */
export async function parseBookmarkTtl(
  resourceUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<BookmarkData | undefined> {
  // Same order as the runtime's parseDocument: refuse an unsafe resource URL before parsing.
  if (!isSafeAbsoluteIri(resourceUrl)) return undefined;
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, contentType ?? "text/turtle", { baseIRI: resourceUrl });
  return parseBookmark(resourceUrl, dataset);
}
