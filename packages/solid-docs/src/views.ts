// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EntityWrapper } from "@jeswr/model-runtime";
import { LEGACY_NAMESPACES } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  type TermWrapper,
} from "@rdfjs/wrapper";
import { type DocumentWrapper, entities, type RevisionWrapper } from "./generated/model.js";
import { PD } from "./vocab.js";

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
function legacyText(view: TermWrapper, predicate: string): string | undefined {
  for (const alias of aliases(predicate)) {
    const value = OptionalFrom.subjectPredicate(view, alias, LiteralAs.string);
    if (value !== undefined) return value;
  }
  return undefined;
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
    return super.body ?? legacyText(this, PD.body);
  }
  override set body(value: string | undefined) {
    clearLegacy(this, PD.body);
    super.body = value;
  }
  override get format(): string | undefined {
    return super.format ?? legacyText(this, PD.format);
  }
  override set format(value: string | undefined) {
    clearLegacy(this, PD.format);
    super.format = value;
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
    return super.body ?? legacyText(this, PD.body);
  }
  override set body(value: string | undefined) {
    clearLegacy(this, PD.body);
    super.body = value;
  }
  override get format(): string | undefined {
    return super.format ?? legacyText(this, PD.format);
  }
  override set format(value: string | undefined) {
    clearLegacy(this, PD.format);
    super.format = value;
  }
}
