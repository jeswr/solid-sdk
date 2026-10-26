// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-photos; original provenance retained below.
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * A single photo as `schema:Photograph` + its EXIF metadata rendered into W3C
 * `exif:` triples (and capture location into `geo:`). The typed `@rdfjs/wrapper`
 * accessors are the ONLY way the technical metadata reaches the dataset — never
 * hand-built quads, never inline Turtle.
 *
 * Document layout (one resource per photo, subject `${itemUrl}#it`):
 *
 *   <#it> a schema:Photograph ;
 *       schema:name        "Sunset over the bay" ;
 *       schema:description "…" ;
 *       schema:contentUrl  <…/sunset.jpg> ;        # the binary
 *       schema:dateCreated "2026-06-15T09:41:07Z"^^xsd:dateTime ;
 *       schema:width  6240 ; schema:height 4160 ;
 *       schema:keywords "bay" , "sunset" ;
 *       exif:make "FUJIFILM" ; exif:model "X-T5" ; exif:fNumber 2.8 ; … ;
 *       schema:geo [ a geo:Point ; geo:lat 51.5 ; geo:long -0.12 ] .
 *
 * The capture point is a nested `geo:Point` blank node (a `schema:geo` object),
 * the standard schema.org ⇄ Basic-Geo pattern. EXIF is split out into queryable
 * `exif:` triples (`exif.ts` did the validation/normalisation).
 */
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
import { DataFactory, Store } from "n3";
import type { ExifMetadata, GeoPoint } from "./exif.js";
import { isExifEmpty, normaliseExif } from "./exif.js";
import { documentUrl, httpIri, isoDate } from "./validation.js";
import { DCT, EXIF, GEO, PHOTOGRAPH_CLASS, RDF_TYPE, SCHEMA } from "./vocab.js";

/** A photo as the UI works with it (plain, serialisable). */
export interface Photo {
  /** Display title — `schema:name`. */
  name: string;
  /** Optional caption — `schema:description`. */
  description?: string;
  /** URL of the actual image binary — `schema:contentUrl` (an IRI). */
  contentUrl: string;
  thumbnailUrl?: string;
  created?: string;
  modified?: string;
  /** Free-text tags — `schema:keywords` (deduped, order-preserving). */
  keywords: string[];
  /** Validated/normalised technical EXIF metadata. */
  exif: ExifMetadata;
}

/** Typed `@rdfjs/wrapper` view of the nested `geo:Point` capture location. */
class GeoPointDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(`${GEO}Point`);
    return this;
  }
  get lat(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${GEO}lat`, LiteralAs.number);
  }
  set lat(v: number | undefined) {
    OptionalAs.object(this, `${GEO}lat`, v, LiteralFrom.double);
  }
  get long(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${GEO}long`, LiteralAs.number);
  }
  set long(v: number | undefined) {
    OptionalAs.object(this, `${GEO}long`, v, LiteralFrom.double);
  }
}

/** Typed `@rdfjs/wrapper` view of a single photo's subject. */
export class PhotographDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(PHOTOGRAPH_CLASS);
    return this;
  }

  // --- schema:* descriptive ---
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, v, LiteralFrom.string);
  }
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}description`, LiteralAs.string);
  }
  set description(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}description`, v, LiteralFrom.string);
  }
  /** `schema:contentUrl` as an IRI (the image binary). */
  get contentUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}contentUrl`, NamedNodeAs.string);
  }
  set contentUrl(v: string | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}contentUrl`,
      v === undefined ? undefined : httpIri(v),
      NamedNodeFrom.string,
    );
  }
  get thumbnailUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}thumbnailUrl`, NamedNodeAs.string);
  }
  set thumbnailUrl(v: string | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}thumbnailUrl`,
      v === undefined ? undefined : httpIri(v),
      NamedNodeFrom.string,
    );
  }
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}created`, LiteralAs.date);
  }
  set created(v: Date | undefined) {
    OptionalAs.object(this, `${DCT}created`, v, LiteralFrom.dateTime);
  }
  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}modified`, LiteralAs.date);
  }
  set modified(v: Date | undefined) {
    OptionalAs.object(this, `${DCT}modified`, v, LiteralFrom.dateTime);
  }
  /** `schema:keywords` — zero or more free-text tag literals. */
  get keywords(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}keywords`,
      LiteralAs.string,
      LiteralFrom.string,
    );
  }

  // --- schema:* dimensions / date (derived from EXIF, also queryable) ---
  get width(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}width`, LiteralAs.number);
  }
  set width(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}width`, v, LiteralFrom.integer);
  }
  get height(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}height`, LiteralAs.number);
  }
  set height(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}height`, v, LiteralFrom.integer);
  }
  get dateCreated(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}dateCreated`, LiteralAs.date);
  }
  set dateCreated(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}dateCreated`, v, LiteralFrom.dateTime);
  }

  // --- exif:* technical metadata ---
  get exifMake(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}make`, LiteralAs.string);
  }
  set exifMake(v: string | undefined) {
    OptionalAs.object(this, `${EXIF}make`, v, LiteralFrom.string);
  }
  get exifModel(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}model`, LiteralAs.string);
  }
  set exifModel(v: string | undefined) {
    OptionalAs.object(this, `${EXIF}model`, v, LiteralFrom.string);
  }
  get exifLensModel(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}lensModel`, LiteralAs.string);
  }
  set exifLensModel(v: string | undefined) {
    OptionalAs.object(this, `${EXIF}lensModel`, v, LiteralFrom.string);
  }
  get exifFocalLength(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}focalLength`, LiteralAs.number);
  }
  set exifFocalLength(v: number | undefined) {
    OptionalAs.object(this, `${EXIF}focalLength`, v, LiteralFrom.double);
  }
  get exifFNumber(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}fNumber`, LiteralAs.number);
  }
  set exifFNumber(v: number | undefined) {
    OptionalAs.object(this, `${EXIF}fNumber`, v, LiteralFrom.double);
  }
  get exifExposureTime(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}exposureTime`, LiteralAs.number);
  }
  set exifExposureTime(v: number | undefined) {
    OptionalAs.object(this, `${EXIF}exposureTime`, v, LiteralFrom.double);
  }
  get exifIso(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}isoSpeedRatings`, LiteralAs.number);
  }
  set exifIso(v: number | undefined) {
    OptionalAs.object(this, `${EXIF}isoSpeedRatings`, v, LiteralFrom.integer);
  }
  get exifOrientation(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${EXIF}orientation`, LiteralAs.number);
  }
  set exifOrientation(v: number | undefined) {
    OptionalAs.object(this, `${EXIF}orientation`, v, LiteralFrom.integer);
  }

  /** The nested `schema:geo` capture point as an IRI/blank-node ref. */
  get geoRef(): Term | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}geo`, TermAs.term);
  }
  set geoRef(v: string | Term | undefined) {
    OptionalAs.object(
      this,
      `${SCHEMA}geo`,
      typeof v === "string" ? DataFactory.namedNode(httpIri(v)) : v,
      TermFrom.itself,
    );
  }
}

/** Lower-cases, trims and dedupes a tag list, dropping blanks (order-preserving). */
export function normaliseKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Parse a comma/newline-separated keyword string into a clean list. */
export function parseKeywordsInput(input: string): string[] {
  return normaliseKeywords(input.split(/[,\n]/));
}

/**
 * Read the EXIF + geo + schema-dimension triples back off a photo subject into
 * an {@link ExifMetadata}. The result is re-normalised, so a tampered document
 * (an out-of-range geo, a junk ISO) yields only the valid parts.
 */
function readExif(doc: PhotographDoc, dataset: DatasetCore): ExifMetadata {
  const raw: Partial<ExifMetadata> = {};
  function readField<K extends keyof ExifMetadata>(key: K, read: () => ExifMetadata[K]): void {
    const value = optionalValue(read);
    if (value !== undefined) raw[key] = value;
  }
  readField("make", () => doc.exifMake);
  readField("model", () => doc.exifModel);
  readField("lensModel", () => doc.exifLensModel);
  readField("focalLengthMm", () => doc.exifFocalLength);
  readField("fNumber", () => doc.exifFNumber);
  readField("exposureTimeSec", () => doc.exifExposureTime);
  readField("iso", () => doc.exifIso);
  readField("orientation", () => doc.exifOrientation);
  readField("pixelWidth", () => doc.width);
  readField("pixelHeight", () => doc.height);
  readField("dateTimeOriginal", () => optionalIso(() => doc.dateCreated));

  const geoRef = doc.geoRef;
  if (geoRef) {
    const point = new GeoPointDoc(geoRef, dataset, DataFactory);
    const lat = optionalValue(() => point.lat);
    const long = optionalValue(() => point.long);
    if (lat !== undefined && long !== undefined) raw.location = { lat, long };
  }
  return normaliseExif(raw);
}

/** Optional RDF values may have the wrong term type or lexical form. */
function optionalValue<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
function optionalIso(read: () => Date | undefined): string | undefined {
  return optionalValue(() => {
    const date = read();
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  });
}

/** Parse a photo document into a {@link Photo}, or `undefined` if not one. */
export function parsePhoto(
  itemUrl: string,
  dataset: DatasetCore,
  subject = `${documentUrl(itemUrl)}#it`,
): Photo | undefined {
  const doc = new PhotographDoc(httpIri(subject), dataset, DataFactory);
  if (!doc.types.has(PHOTOGRAPH_CLASS) && !doc.types.has(`${SCHEMA}ImageObject`)) return undefined;
  const thumbnailUrl = optionalValue(() => doc.thumbnailUrl);
  const created = optionalIso(() => doc.created);
  const modified = optionalIso(() => doc.modified);
  return {
    name: doc.name ?? "",
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    contentUrl: doc.contentUrl ?? "",
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    ...(created ? { created } : {}),
    ...(modified ? { modified } : {}),
    keywords: normaliseKeywords([...doc.keywords].sort((a, b) => a.localeCompare(b))),
    exif: readExif(doc, dataset),
  };
}

/** Write a {@link GeoPoint} into the dataset and link it from the photo's `schema:geo`. */
function writeGeo(itemUrl: string, photoDoc: PhotographDoc, store: Store, point: GeoPoint): void {
  const geoRef = `${itemUrl}#geo`;
  const geo = new GeoPointDoc(geoRef, store, DataFactory).mark();
  geo.lat = point.lat;
  geo.long = point.long;
  photoDoc.geoRef = geoRef;
}

/** Serialise a {@link Photo} into a fresh dataset rooted at `${itemUrl}#it`. */
export function buildPhoto(itemUrl: string, photo: Photo): Store {
  itemUrl = documentUrl(itemUrl);
  const store = new Store();
  const doc = new PhotographDoc(`${itemUrl}#it`, store, DataFactory).mark();
  doc.name = photo.name || undefined;
  doc.description = photo.description || undefined;
  doc.contentUrl = httpIri(photo.contentUrl);
  doc.thumbnailUrl = photo.thumbnailUrl;
  if (photo.created) doc.created = new Date(isoDate(photo.created));
  if (photo.modified) doc.modified = new Date(isoDate(photo.modified));
  for (const kw of normaliseKeywords(photo.keywords)) doc.keywords.add(kw);

  const exif = normaliseExif(photo.exif);
  if (!isExifEmpty(exif)) {
    doc.exifMake = exif.make;
    doc.exifModel = exif.model;
    doc.exifLensModel = exif.lensModel;
    doc.exifFocalLength = exif.focalLengthMm;
    doc.exifFNumber = exif.fNumber;
    doc.exifExposureTime = exif.exposureTimeSec;
    doc.exifIso = exif.iso;
    doc.exifOrientation = exif.orientation;
    // EXIF pixel dimensions ⇒ schema:width/height (the schema.org idiom).
    doc.width = exif.pixelWidth;
    doc.height = exif.pixelHeight;
    if (exif.dateTimeOriginal) doc.dateCreated = new Date(exif.dateTimeOriginal);
    if (exif.location) writeGeo(itemUrl, doc, store, exif.location);
  }
  return store;
}

/** Read multi-subject connector documents as well as one-photo item documents. */
export function parsePhotos(
  itemUrl: string,
  dataset: DatasetCore,
): { subject: string; photo: Photo }[] {
  documentUrl(itemUrl);
  const subjects = new Set<string>();
  for (const quad of dataset.match(null, DataFactory.namedNode(RDF_TYPE))) {
    if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
  }
  const photos: { subject: string; photo: Photo }[] = [];
  for (const subject of [...subjects].sort()) {
    const types = new PhotographDoc(subject, dataset, DataFactory).types;
    if (types.has(PHOTOGRAPH_CLASS) || types.has(`${SCHEMA}ImageObject`)) {
      // The type check above guarantees a photograph.
      const photo = parsePhoto(itemUrl, dataset, subject) as Photo;
      photos.push({ subject, photo });
    }
  }
  return photos;
}
