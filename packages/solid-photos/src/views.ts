// AUTHORED-BY Codex (GPT-6.1 Sol)
/** Generated accessors plus the two RDF-term links outside closed admission. */
import type { DatasetCore, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import {
  entities,
  type ImageGalleryData,
  type ImageGalleryWrapper,
  type ListItemWrapper,
  type PhotographData,
  type PhotographWrapper,
  type TrashData,
  type TrashWrapper,
} from "./generated/model.js";
import { documentUrl, httpIri } from "./validation.js";
import { GEO, RDF_TYPE, SCHEMA } from "./vocab.js";

// Generated optional properties need explicit clearing types for consumers using
// exactOptionalPropertyTypes; field behavior still comes entirely from the runtime.
type PhotoFields = Exclude<keyof PhotographData, "keywords">;
type PhotoAccessors = { [Key in PhotoFields]: PhotographWrapper[Key] };
interface PhotoView
  extends TermWrapper,
    Omit<PhotographWrapper, PhotoFields | "mark">,
    PhotoAccessors {
  mark(): this;
}
const PhotoWrapper = entities.Photograph.Wrapper as new (
  ...args: ConstructorParameters<typeof entities.Photograph.Wrapper>
) => PhotoView;
type GalleryFields = Exclude<keyof ImageGalleryData, "legacyMembers">;
type GalleryView = TermWrapper &
  Omit<ImageGalleryWrapper, GalleryFields> & {
    [Key in GalleryFields]: ImageGalleryWrapper[Key];
  };
const GalleryWrapper = entities.ImageGallery.Wrapper as new (
  ...args: ConstructorParameters<typeof entities.ImageGallery.Wrapper>
) => GalleryView;
type TrashView = TermWrapper &
  Omit<TrashWrapper, keyof TrashData> & {
    [Key in keyof Required<TrashData>]: TrashWrapper[Key];
  };
const TrashWrapperBase = entities.Trash.Wrapper as new (
  ...args: ConstructorParameters<typeof entities.Trash.Wrapper>
) => TrashView;

export class PhotographDoc extends PhotoWrapper {
  override mark(): this {
    super.mark();
    return this;
  }
  override get contentUrl(): string | undefined {
    return super.contentUrl;
  }
  override set contentUrl(value: string | undefined) {
    super.contentUrl = value === undefined ? undefined : httpIri(value);
  }
  override get thumbnailUrl(): string | undefined {
    return super.thumbnailUrl;
  }
  override set thumbnailUrl(value: string | undefined) {
    super.thumbnailUrl = value === undefined ? undefined : httpIri(value);
  }
  // Generator gap: BlankNodeOrIRI values are not admitted. Preserve the RDF term.
  get geoRef(): Term | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}geo`, TermAs.term);
  }
  set geoRef(value: string | Term | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}geo`,
      typeof value === "string" ? DataFactory.namedNode(httpIri(value)) : value,
      TermFrom.itself,
    );
  }
}

/** Receipt-only tombstones use the generated PROV property without marking an Entity. */
export class RestoreReceipt extends TrashWrapperBase {
  override get restoreActivity(): string | undefined {
    return super.restoreActivity;
  }
  override set restoreActivity(value: string | undefined) {
    super.restoreActivity = value === undefined ? undefined : httpIri(value);
  }
}

export class ImageGalleryDoc extends GalleryWrapper {
  override get coverUrl(): string | undefined {
    return super.coverUrl;
  }
  override set coverUrl(value: string | undefined) {
    super.coverUrl = value === undefined ? undefined : httpIri(value);
  }
  // Generator gap: repeated child nodes and BlankNodeOrIRI links need a term set.
  get elements(): Set<Term> {
    return SetFrom.subjectPredicate(this, `${SCHEMA}itemListElement`, TermAs.term, TermFrom.itself);
  }
}

export class TrashDoc extends RestoreReceipt {
  override get originalUrl(): string | undefined {
    return super.originalUrl;
  }
  override set originalUrl(value: string | undefined) {
    super.originalUrl = value === undefined ? undefined : documentUrl(value);
  }
  override get actor(): string | undefined {
    return super.actor;
  }
  override set actor(value: string | undefined) {
    super.actor = value === undefined ? undefined : httpIri(value);
  }
  override get restoreActivity(): string | undefined {
    return super.restoreActivity;
  }
  override set restoreActivity(value: string | undefined) {
    super.restoreActivity = value === undefined ? undefined : httpIri(value);
  }
}

// Generator gap: generated Wrapper constructors require named subjects. These
// minimal views read existing blank-node points and ListItems without re-identifying
// them. All newly built nodes and all named ListItem fields use generated accessors.
class BlankListItem extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get item(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}item`, NamedNodeAs.string);
  }
  set item(value: string | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}item`,
      value === undefined ? undefined : httpIri(value),
      NamedNodeFrom.string,
    );
  }
  get position(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}position`, LiteralAs.number);
  }
  set position(value: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}position`, value, LiteralFrom.integer);
  }
}

/** Preserve the public class and blank-node identity; named fields delegate. */
export class ListItemDoc extends BlankListItem {
  private get generated(): ListItemWrapper | undefined {
    return this.termType !== "NamedNode"
      ? undefined
      : new entities.ListItem.Wrapper(
          this.factory.namedNode(this.value),
          this.dataset,
          this.factory,
        );
  }
  override get types(): Set<string> {
    return this.generated?.types ?? super.types;
  }
  override get item(): string | undefined {
    const doc = this.generated;
    return doc ? doc.item : super.item;
  }
  override set item(value: string | undefined) {
    const doc = this.generated;
    if (doc) doc.item = value === undefined ? undefined : httpIri(value);
    else super.item = value;
  }
  override get position(): number | undefined {
    const doc = this.generated;
    return doc ? doc.position : super.position;
  }
  override set position(value: number | undefined) {
    const doc = this.generated;
    if (doc) doc.position = value;
    else super.position = value;
  }
}

class CapturePoint extends TermWrapper {
  // Numeric datatype unions in imported geo data are outside closed admission.
  get lat(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${GEO}lat`, LiteralAs.number);
  }
  get long(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${GEO}long`, LiteralAs.number);
  }
}
export function capturePoint(subject: Term, dataset: DatasetCore): CapturePoint {
  return new CapturePoint(subject, dataset, DataFactory);
}
