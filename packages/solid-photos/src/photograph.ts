// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5
/** Public photo model over generated fields; EXIF normalization remains domain policy. */
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import type { ExifMetadata } from "./exif.js";
import { normaliseExif } from "./exif.js";
import { entities, type PhotographData } from "./generated/model.js";
import { normaliseKeywords } from "./keywords.js";
import { orderedStore, PHOTO_PREDICATE_ORDER } from "./order.js";
import type { Photo } from "./types.js";
import { documentUrl, httpIri, isoDate, optionalHttpIri } from "./validation.js";
import {
  capturePoint,
  type LenientPhoto,
  lenientPhoto,
  PhotographDoc,
  RestoreReceipt,
} from "./views.js";
import { DCT, EXIF, RDF_TYPE, SCHEMA } from "./vocab.js";

export { normaliseKeywords, parseKeywordsInput } from "./keywords.js";
export type { Photo } from "./types.js";
export { PhotographDoc, RestoreReceipt };

function readExif(
  doc: PhotographData,
  geoRef: Term | undefined,
  dataset: DatasetCore,
  lenient?: LenientPhoto,
): ExifMetadata {
  const point = geoRef ? capturePoint(geoRef, dataset) : undefined;
  const lat = optionalValue(() => point?.lat);
  const long = optionalValue(() => point?.long);
  return normaliseExif({
    make: doc.exifMake ?? lenient?.text(`${EXIF}make`),
    model: doc.exifModel ?? lenient?.text(`${EXIF}model`),
    lensModel: doc.exifLensModel ?? lenient?.text(`${EXIF}lensModel`),
    focalLengthMm: doc.exifFocalLength ?? lenient?.number(`${EXIF}focalLength`),
    fNumber: doc.exifFNumber ?? lenient?.number(`${EXIF}fNumber`),
    exposureTimeSec: doc.exifExposureTime ?? lenient?.number(`${EXIF}exposureTime`),
    iso: doc.exifIso ?? lenient?.number(`${EXIF}isoSpeedRatings`),
    orientation: doc.exifOrientation ?? lenient?.number(`${EXIF}orientation`),
    pixelWidth: doc.width ?? lenient?.number(`${SCHEMA}width`),
    pixelHeight: doc.height ?? lenient?.number(`${SCHEMA}height`),
    dateTimeOriginal: (doc.dateCreated ?? lenient?.date(`${SCHEMA}dateCreated`))?.toISOString(),
    location: lat === undefined || long === undefined ? undefined : { lat, long },
  });
}

/** Legacy blank-node numeric accessors may throw on a malformed term. */
function optionalValue<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function parsePhoto(
  itemUrl: string,
  dataset: DatasetCore,
  subject = `${documentUrl(itemUrl)}#it`,
): Photo | undefined {
  subject = httpIri(subject);
  return photoFromCore(
    dataset,
    subject,
    entities.Photograph.parse(subject, dataset) ?? entities.ImageObject.parse(subject, dataset),
  );
}

/**
 * Read a photo for write-back. Like {@link parsePhoto}, but a field the strict generated
 * reader drops (language-tagged text, decimal numbers, `xsd:date`, extra values of a
 * singleton) falls back to the first literal's lexical value, as the hand-written model
 * did. Use this before rebuilding a document so an edit never erases such metadata.
 */
export function parseStoredPhoto(
  itemUrl: string,
  dataset: DatasetCore,
  subject = `${documentUrl(itemUrl)}#it`,
): Photo | undefined {
  subject = httpIri(subject);
  return photoFromCore(
    dataset,
    subject,
    entities.Photograph.parse(subject, dataset) ?? entities.ImageObject.parse(subject, dataset),
    true,
  );
}

/** Project an already-parsed core once, so scans do not re-run class recognition. */
function photoFromCore(
  dataset: DatasetCore,
  subject: string,
  core: ReturnType<typeof entities.Photograph.parse>,
  tolerant = false,
): Photo | undefined {
  if (!core) return undefined;
  const doc = new PhotographDoc(subject, dataset, DataFactory);
  const lenient = tolerant ? lenientPhoto(subject, dataset) : undefined;
  const created = (core.created ?? lenient?.date(`${DCT}created`))?.toISOString();
  const modified = (core.modified ?? lenient?.date(`${DCT}modified`))?.toISOString();
  const description = core.description ?? lenient?.text(`${SCHEMA}description`);
  // The library renders and fetches these IRIs, so only http(s) values leave the facade.
  const contentUrl = optionalHttpIri(core.contentUrl ?? lenient?.iri(`${SCHEMA}contentUrl`));
  const thumbnailUrl = optionalHttpIri(core.thumbnailUrl ?? lenient?.iri(`${SCHEMA}thumbnailUrl`));
  const keywords = lenient ? lenient.textSet(`${SCHEMA}keywords`) : (core.keywords ?? []);
  return {
    name: core.name ?? lenient?.text(`${SCHEMA}name`) ?? "",
    ...(description !== undefined ? { description } : {}),
    contentUrl: contentUrl ?? "",
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    ...(created ? { created } : {}),
    ...(modified ? { modified } : {}),
    keywords: normaliseKeywords([...keywords].sort((a, b) => a.localeCompare(b))),
    exif: readExif(core, doc.geoRef, dataset, lenient),
  };
}

export function buildPhoto(itemUrl: string, photo: Photo): Store {
  itemUrl = documentUrl(itemUrl);
  const exif = normaliseExif(photo.exif);
  const dataset = entities.Photograph.build(`${itemUrl}#it`, {
    name: photo.name || undefined,
    description: photo.description || undefined,
    contentUrl: httpIri(photo.contentUrl),
    thumbnailUrl: photo.thumbnailUrl === undefined ? undefined : httpIri(photo.thumbnailUrl),
    created: photo.created ? new Date(isoDate(photo.created)) : undefined,
    modified: photo.modified ? new Date(isoDate(photo.modified)) : undefined,
    keywords: normaliseKeywords(photo.keywords),
    exifMake: exif.make,
    exifModel: exif.model,
    exifLensModel: exif.lensModel,
    exifFocalLength: exif.focalLengthMm,
    exifFNumber: exif.fNumber,
    exifExposureTime: exif.exposureTimeSec,
    exifIso: exif.iso,
    exifOrientation: exif.orientation,
    width: exif.pixelWidth,
    height: exif.pixelHeight,
    dateCreated: exif.dateTimeOriginal ? new Date(exif.dateTimeOriginal) : undefined,
  });
  if (exif.location) {
    const subject = `${itemUrl}#geo`;
    for (const quad of entities.GeoPoint.build(subject, exif.location)) dataset.add(quad);
    new PhotographDoc(`${itemUrl}#it`, dataset, DataFactory).geoRef = subject;
  }
  return orderedStore(dataset, PHOTO_PREDICATE_ORDER);
}

export function parsePhotos(
  itemUrl: string,
  dataset: DatasetCore,
  options: { tolerant?: boolean } = {},
): { subject: string; photo: Photo }[] {
  documentUrl(itemUrl);
  const subjects = new Set<string>();
  for (const quad of dataset.match(null, DataFactory.namedNode(RDF_TYPE))) {
    if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
  }
  return [...subjects].sort().flatMap((subject) => {
    const core =
      entities.Photograph.parse(subject, dataset) ?? entities.ImageObject.parse(subject, dataset);
    const photo = core
      ? photoFromCore(dataset, httpIri(subject), core, options.tolerant === true)
      : undefined;
    return photo ? [{ subject, photo }] : [];
  });
}
