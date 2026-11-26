// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5

import {
  type EntityWrapper,
  isXsdDate,
  isXsdDateTime,
  isXsdDateTimeStamp,
} from "@jeswr/model-runtime";
import { LEGACY_NAMESPACES } from "@jeswr/suite-vocab";
import type { Literal } from "@rdfjs/types";
import {
  LiteralAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  type TermWrapper,
} from "@rdfjs/wrapper";
import { type DocumentWrapper, entities, type RevisionWrapper } from "./generated/model.js";
import { DCT, PD, PROV } from "./vocab.js";

// Generator gap: the same canonical predicate cannot have aliases on two owners.
// Only body/format need this bridge; every other field is wholly generated.
function aliases(predicate: string): string[] {
  return [
    ...new Set(
      Object.entries(LEGACY_NAMESPACES)
        .filter(([, canonical]) => predicate.startsWith(canonical))
        .map(([legacy, canonical]) => legacy + predicate.slice(canonical.length)),
    ),
  ];
}
const XSD_DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime";
function firstLiteral(view: TermWrapper, predicate: string): Literal | undefined {
  for (const term of SetFrom.subjectPredicate(view, predicate, TermAs.term, TermFrom.itself))
    if (term.termType === "Literal") return term;
  return undefined;
}
/**
 * Tolerant read (review F3): the generated getters drop a language-tagged, duplicated or
 * differently-typed scalar, and the app rebuilds the whole resource on save, so the drop
 * would become permanent data loss. When the strict value is absent but a literal is
 * present, return the first non-empty literal's lexical form, as the hand-written model did.
 * An empty lexical form reads as absent so callers apply their default.
 */
function tolerantText(
  view: TermWrapper,
  predicate: string,
  value: string | undefined,
): string | undefined {
  if (value !== undefined) return value;
  const lexical = firstLiteral(view, predicate)?.value;
  return lexical === "" ? undefined : lexical;
}
const XSD = "http://www.w3.org/2001/XMLSchema#";
const DATE_TYPES: Record<string, (lexical: string) => boolean> = {
  [XSD_DATE_TIME]: isXsdDateTime,
  [`${XSD}dateTimeStamp`]: isXsdDateTimeStamp,
  [`${XSD}date`]: isXsdDate,
  [`${XSD}string`]: (lexical) => isXsdDateTime(lexical) || isXsdDate(lexical),
};
function literalDate(literal: Literal): Date | undefined {
  const valid = DATE_TYPES[literal.datatype.value];
  if (!valid?.(literal.value)) return undefined;
  const parsed = new Date(literal.value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
/**
 * As {@link tolerantText}, for dates: the strict getter also yields undefined for several
 * well-formed values, so every literal is checked and the first valid `xsd:dateTime`,
 * `xsd:dateTimeStamp`, `xsd:date` or ISO-shaped plain string wins. Malformed dateTimes and
 * other datatypes (`dct:created 5`) stay dropped, as the generated model pins.
 */
function tolerantDate(
  view: TermWrapper,
  predicate: string,
  value: Date | undefined,
): Date | undefined {
  if (value !== undefined) return value;
  const dates: Date[] = [];
  for (const term of SetFrom.subjectPredicate(view, predicate, TermAs.term, TermFrom.itself)) {
    const date = term.termType === "Literal" ? literalDate(term) : undefined;
    if (date) dates.push(date);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates[0];
}
function legacyText(view: TermWrapper, predicate: string): string | undefined {
  for (const alias of aliases(predicate)) {
    const value = OptionalFrom.subjectPredicate(view, alias, LiteralAs.string);
    if (value !== undefined) return value;
  }
  return undefined;
}
/**
 * Legacy aliases are read only when the canonical predicate is absent: an ambiguous or
 * differently-typed canonical literal is read tolerantly (first lexical value) rather than
 * falling back to stale legacy text.
 */
function canonicalOrLegacy(
  view: TermWrapper,
  predicate: string,
  value: string | undefined,
): string | undefined {
  if (value !== undefined) return value;
  if (SetFrom.subjectPredicate(view, predicate, TermAs.term, TermFrom.itself).size > 0)
    return tolerantText(view, predicate, undefined);
  return legacyText(view, predicate);
}
function clearLegacy(view: TermWrapper, predicate: string): void {
  for (const alias of aliases(predicate))
    SetFrom.subjectPredicate(view, alias, TermAs.term, TermFrom.itself).clear();
}
// Preserve the original clearing setters, including exactOptionalPropertyTypes consumers.
type DocumentFields = {
  [Key in Exclude<keyof DocumentWrapper, keyof EntityWrapper>]-?: DocumentWrapper[Key];
};
type RevisionFields = {
  [Key in Exclude<keyof RevisionWrapper, keyof EntityWrapper>]-?: RevisionWrapper[Key];
};
interface PublicDocument
  extends TermWrapper,
    Omit<DocumentWrapper, keyof DocumentFields | "mark">,
    DocumentFields {
  mark(): this;
}
interface PublicRevision
  extends TermWrapper,
    Omit<RevisionWrapper, keyof RevisionFields | "mark">,
    RevisionFields {
  mark(): this;
}
const DocumentBase = entities.Document.Wrapper as new (
  ...args: ConstructorParameters<typeof entities.Document.Wrapper>
) => PublicDocument;
const RevisionBase = entities.Revision.Wrapper as new (
  ...args: ConstructorParameters<typeof entities.Revision.Wrapper>
) => PublicRevision;

/** Generated accessors with the legacy shared-content bridge and throwing count policy. */
export class DocumentDoc extends DocumentBase {
  override get body(): string | undefined {
    return canonicalOrLegacy(this, PD.body, super.body);
  }
  override set body(value: string | undefined) {
    clearLegacy(this, PD.body);
    super.body = value;
  }
  override get format(): string | undefined {
    return canonicalOrLegacy(this, PD.format, super.format);
  }
  override set format(value: string | undefined) {
    clearLegacy(this, PD.format);
    super.format = value;
  }
  override get title(): string | undefined {
    return tolerantText(this, DCT.title, super.title);
  }
  override set title(value: string | undefined) {
    super.title = value;
  }
  override get created(): Date | undefined {
    return tolerantDate(this, DCT.created, super.created);
  }
  override set created(value: Date | undefined) {
    super.created = value;
  }
  override get modified(): Date | undefined {
    return tolerantDate(this, DCT.modified, super.modified);
  }
  override set modified(value: Date | undefined) {
    super.modified = value;
  }
  override get wordCount(): number | undefined {
    return super.wordCount;
  }
  override set wordCount(value: number | undefined) {
    assertWordCount(value);
    super.wordCount = value;
  }
}
export function assertWordCount(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw new RangeError("Word count must be a non-negative integer");
}
/** Generated revision view with the same two legacy content predicates. */
export class RevisionDoc extends RevisionBase {
  override get body(): string | undefined {
    return canonicalOrLegacy(this, PD.body, super.body);
  }
  override set body(value: string | undefined) {
    clearLegacy(this, PD.body);
    super.body = value;
  }
  override get format(): string | undefined {
    return canonicalOrLegacy(this, PD.format, super.format);
  }
  override set format(value: string | undefined) {
    clearLegacy(this, PD.format);
    super.format = value;
  }
  override get generatedAt(): Date | undefined {
    return tolerantDate(this, PROV.generatedAtTime, super.generatedAt);
  }
  override set generatedAt(value: Date | undefined) {
    super.generatedAt = value;
  }
}
