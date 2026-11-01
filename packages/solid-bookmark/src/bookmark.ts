// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-5
/** Public bookmark API over the ontology/SHACL-generated model. */
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { type BookmarkData, type BookmarkWrapper, entities } from "./generated/model.js";
import {
  BOOK_ARCHIVED,
  BOOK_NOTES,
  DCT_CREATED,
  DCT_DESCRIPTION,
  DCT_MODIFIED,
  DCT_TITLE,
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

/** Fail closed on a missing/invalid URL; omit absent optional fields. */
export function parseBookmark(resourceUrl: string, dataset: DatasetCore): BookmarkData | undefined {
  return publicData(bm.parse(resourceUrl, dataset));
}

/** Parse via fetch-rdf, defaulting an absent/null Content-Type to Turtle. */
export async function parseBookmarkTtl(
  resourceUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<BookmarkData | undefined> {
  return publicData(await bm.parseDocument(resourceUrl, body, contentType));
}
