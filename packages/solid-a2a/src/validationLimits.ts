// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Quad, Term } from "@rdfjs/types";

const SH_NS = "http://www.w3.org/ns/shacl#";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const MAX_DATA_QUADS = 1_000;
const MAX_SHAPE_QUADS = 10_000;
// Count every occurrence, including datatype, language, direction and graph names.
// These caps bound caller encoding as well as worker parsing and term copies.
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

function termCharacters(term: Term): number {
  return term.termType === "Literal"
    ? term.value.length +
        term.language.length +
        term.datatype.value.length +
        ((term as typeof term & { direction?: string }).direction?.length ?? 0)
    : term.value.length;
}

/** Why a term is too long to evaluate, or undefined. */
function oversizedTerm(term: Term, predicate?: string): string | undefined {
  if (term.termType === "Quad") return "Quoted triples";
  // A literal's serialised id carries its language tag and datatype IRI too.
  const length = termCharacters(term);
  if (term.termType !== "Literal") {
    return length > MAX_TERM_LENGTH ? `Terms over ${MAX_TERM_LENGTH} characters` : undefined;
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
  const quads: Quad[] = [];
  for (const q of input) {
    if (quads.length === limit) throw tooMany();
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      const why = oversizedTerm(term, shapes && term === q.object ? q.predicate.value : undefined);
      if (why !== undefined) throw new Error(`${why} ${UNBOUNDED}`);
      characters += termCharacters(term);
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
