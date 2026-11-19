// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Quad, Term } from "@rdfjs/types";

const SH_NS = "http://www.w3.org/ns/shacl#";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const MAX_DATA_QUADS = 1_000;
const MAX_SHAPE_QUADS = 10_000;
// Count every occurrence, including datatype, language, direction and graph names,
// weighting N-Quads escapes before the Writer allocates them on the caller.
export const MAX_DATA_CHARACTERS = 1_048_576;
export const MAX_SHAPE_CHARACTERS = 4_194_304;

export const UNBOUNDED = "are not evaluated (unbounded cost)";

/**
 * Term length caps. The validator keys, copies and pattern-matches whole term
 * values outside any dataset operation: it serialises the focus term on every
 * shape evaluation, copies each message into every result, and checks typed
 * literals against backtracking lexical patterns. An intent is short text.
 */
export const MAX_TERM_LENGTH = 4_096;
const MAX_LABEL_LENGTH = 1_024;
const MAX_TYPED_LITERAL_LENGTH = 128;
/** BCP 47 tags in practice; a long tag is copied with its literal everywhere. */
const MAX_LANGUAGE_TAG_LENGTH = 35;
const LABELS = new Set(["message", "name", "description"].map((p) => SH_NS + p));
/** Datatypes whose lexical form is a plain string, checked without a pattern. */
const PLAIN_DATATYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#string",
  `${RDF_NS}langString`,
  `${RDF_NS}dirLangString`,
]);

// RFC 5646 section 2.1: syntax, including private-use and grandfathered tags.
// Direction is a separate RDF/JS field, never an implicit suffix in language.
const GRANDFATHERED = new Set(
  (
    "en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo " +
    "i-navajo i-pwn i-tao i-tay i-tsu sgn-be-fr sgn-be-nl sgn-ch-de art-lojban " +
    "cel-gaulish no-bok no-nyn zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang"
  ).split(" "),
);
const LANGUAGE_TAG =
  /^(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?((?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*)((?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*)(?:-x(?:-[a-z0-9]{1,8})+)?$/;
function validLanguageTag(language: string): boolean {
  const tag = language.toLowerCase();
  if (GRANDFATHERED.has(tag) || /^x(?:-[a-z0-9]{1,8})+$/.test(tag)) return true;
  const match = LANGUAGE_TAG.exec(tag);
  if (!match) return false;
  const variants = match[1] ? match[1].slice(1).split("-") : [];
  const extensions = (match[2] ?? "").split("-").filter((part) => part.length === 1);
  return (
    new Set(variants).size === variants.length && new Set(extensions).size === extensions.length
  );
}

function invalidIri(value: string): boolean {
  // N3 Writer does not escape these IRIREF delimiters. Reject controls,
  // whitespace and lone surrogates too; N-Quads requires absolute IRIs.
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: RDF term syntax boundary.
    /[\s\u0000-\u0020\u007f-\u009f<>"{}|^`\\\ud800-\udfff]/u.test(value)
  );
}

/** Escaped lexical length, without constructing the expanded string. */
function escapedCharacters(value: string, lengths: Map<string, number>): number {
  let length = value.length;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Account for N-Quads escaping.
  if (!/["\\\u0000-\u001f\ud800-\udbff]/.test(value)) return length;
  const cached = lengths.get(value);
  if (cached !== undefined) return cached;
  // A surrogate pair becomes ten ASCII characters; other escapes take two or
  // six. Charge all C0 controls conservatively, including N3's raw U+001A–1F.
  // Scan without allocating one match object per hostile character.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 34 ||
      code === 92 ||
      code === 8 ||
      code === 9 ||
      code === 10 ||
      code === 12 ||
      code === 13
    )
      length += 1;
    else if (code < 32) length += 5;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 8;
        index += 1;
      }
    }
  }
  lengths.set(value, length);
  return length;
}

function transferCharacters(term: Term, lengths: Map<string, number>): number {
  return (
    termCharacters(term) +
    escapedCharacters(term.value, lengths) -
    term.value.length +
    (term.termType === "Literal"
      ? escapedCharacters(term.datatype.value, lengths) - term.datatype.value.length
      : 0)
  );
}

function termCharacters(term: Term): number {
  return term.termType === "Literal"
    ? term.value.length +
        term.language.length +
        term.datatype.value.length +
        ((term as typeof term & { direction?: string }).direction?.length ?? 0)
    : term.value.length;
}

/** Why a term cannot be safely evaluated or transferred, or undefined. */
function oversizedTerm(term: Term, predicate?: string): string | undefined {
  if (term.termType === "Quad") return "Quoted triples";
  // A literal's serialised id carries its language tag and datatype IRI too.
  const length = termCharacters(term);
  if (term.termType !== "Literal") {
    if (length > MAX_TERM_LENGTH) return `Terms over ${MAX_TERM_LENGTH} characters`;
    if (term.termType === "NamedNode" && invalidIri(term.value)) return "IRIs with invalid syntax";
    return undefined;
  }
  const direction = (term as typeof term & { direction?: string }).direction ?? "";
  if (
    (direction !== "" && direction !== "ltr" && direction !== "rtl") ||
    (direction !== "" && !term.language)
  ) {
    return "Literals with an invalid direction";
  }
  if (length > MAX_TERM_LENGTH) return `Terms over ${MAX_TERM_LENGTH} characters`;
  if (term.language.length > MAX_LANGUAGE_TAG_LENGTH) {
    return `Language tags over ${MAX_LANGUAGE_TAG_LENGTH} characters`;
  }
  if (term.language && !validLanguageTag(term.language))
    return "Literals with an invalid language tag";
  if (invalidIri(term.datatype.value)) return "Datatype IRIs with invalid syntax";
  if (predicate !== undefined && LABELS.has(predicate) && length > MAX_LABEL_LENGTH) {
    return `Shape labels over ${MAX_LABEL_LENGTH} characters`;
  }
  if (!PLAIN_DATATYPES.has(term.datatype.value) && length > MAX_TYPED_LITERAL_LENGTH) {
    return `Typed literals over ${MAX_TYPED_LITERAL_LENGTH} characters`;
  }
  return undefined;
}

/** Shared caller/worker preflight, before normalization, conversion or serialization. */
export function checkedQuads(
  input: readonly Quad[] | DatasetCore,
  shapes: boolean,
): readonly Quad[] {
  const limit = shapes ? MAX_SHAPE_QUADS : MAX_DATA_QUADS;
  const count = Array.isArray(input) ? input.length : (input as DatasetCore).size;
  const tooMany = () =>
    new Error(`${shapes ? "Shapes" : "Intent graphs"} over ${limit} triples ${UNBOUNDED}`);
  if (count > limit) throw tooMany();
  const characterLimit = shapes ? MAX_SHAPE_CHARACTERS : MAX_DATA_CHARACTERS;
  let characters = 0;
  // Repeated values still count in full; only their escape-length scan is shared.
  const lengths = new Map<string, number>();
  const quads: Quad[] = [];
  for (const q of input) {
    if (quads.length === limit) throw tooMany();
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      const why = oversizedTerm(term, shapes && term === q.object ? q.predicate.value : undefined);
      if (why !== undefined) throw new Error(`${why} ${UNBOUNDED}`);
      characters += transferCharacters(term, lengths);
      if (characters > characterLimit) {
        throw new Error(
          `${shapes ? "Shapes" : "Intent graphs"} over ${characterLimit} total characters ${UNBOUNDED}`,
        );
      }
    }
    quads.push(q);
  }
  return quads;
}
