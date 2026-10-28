// AUTHORED-BY Codex
import { SetFrom, TermAs, TermFrom, type TermWrapper } from "@rdfjs/wrapper";
import { guessContentType } from "./mime";

const DCT_FORMAT = "http://purl.org/dc/terms/format";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const IANA_TYPE = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/(.+)#Resource$/;
const IANA_FORMAT = /^https?:\/\/www\.iana\.org\/assignments\/media-types\/(.+)$/;

function essence(value: string | undefined): string | undefined {
  const type = value?.split(";")[0]?.trim().toLowerCase();
  return type && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : undefined;
}

/** Read each value through typed accessors so a foreign term cannot hide a valid one. */
function declaredType(resource: TermWrapper, predicate: string): string | undefined {
  const terms = SetFrom.subjectPredicate(resource, predicate, TermAs.term, TermFrom.itself);
  for (const term of terms) {
    const value =
      term.termType === "NamedNode"
        ? essence(
            IANA_TYPE.exec(term.value)?.[1] ??
              (predicate === DCT_FORMAT ? IANA_FORMAT.exec(term.value)?.[1] : undefined),
          )
        : term.termType === "Literal" && predicate === DCT_FORMAT
          ? essence(term.value)
          : undefined;
    if (value) return value;
  }
  return undefined;
}

/** Shared by every Drive surface; response MIME is used only when already available. */
export function resolveContentType(
  name: string,
  contentType?: string,
  resource?: TermWrapper,
): string | undefined {
  const declared = resource
    ? (declaredType(resource, DCT_FORMAT) ?? declaredType(resource, RDF_TYPE))
    : undefined;
  const known = declared ?? essence(contentType);
  if (known) return known;
  try {
    // URL segments may decode to separators even though upload names cannot contain them.
    return guessContentType(name.split(/[/\\]/).pop() || "file");
  } catch {
    return undefined;
  }
}
