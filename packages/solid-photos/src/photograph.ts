// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
/** Public photo model over generated fields; EXIF normalization remains domain policy. */
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import type { ExifMetadata } from "./exif.js";
import { normaliseExif } from "./exif.js";
import { entities, type PhotographData } from "./generated/model.js";
import { normaliseKeywords } from "./keywords.js";
import { orderedStore, PHOTO_PREDICATE_ORDER } from "./order.js";
import type { Photo } from "./types.js";
import { documentUrl, httpIri, isoDate } from "./validation.js";
import { capturePoint, PhotographDoc, RestoreReceipt } from "./views.js";
import { RDF_TYPE } from "./vocab.js";

export { normaliseKeywords, parseKeywordsInput } from "./keywords.js";
export type { Photo } from "./types.js";
export { PhotographDoc, RestoreReceipt };

function readExif(
  doc: PhotographData,
  geoRef: Term | undefined,
  dataset: DatasetCore,
): ExifMetadata {
  const point = geoRef ? capturePoint(geoRef, dataset) : undefined;
  const lat = optionalValue(() => point?.lat);
  const long = optionalValue(() => point?.long);
  return normaliseExif({
    make: doc.exifMake,
    model: doc.exifModel,
    lensModel: doc.exifLensModel,
    focalLengthMm: doc.exifFocalLength,
    fNumber: doc.exifFNumber,
    exposureTimeSec: doc.exifExposureTime,
    iso: doc.exifIso,
    orientation: doc.exifOrientation,
    pixelWidth: doc.width,
    pixelHeight: doc.height,
    dateTimeOriginal: doc.dateCreated?.toISOString(),
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

/** Project an already-parsed core once, so scans do not re-run class recognition. */
function photoFromCore(
  dataset: DatasetCore,
  subject: string,
  core: ReturnType<typeof entities.Photograph.parse>,
): Photo | undefined {
  if (!core) return undefined;
  const doc = new PhotographDoc(subject, dataset, DataFactory);
  const created = core.created?.toISOString();
  const modified = core.modified?.toISOString();
  return {
    name: core.name ?? "",
    ...(core.description !== undefined ? { description: core.description } : {}),
    contentUrl: core.contentUrl ?? "",
    ...(core.thumbnailUrl !== undefined ? { thumbnailUrl: core.thumbnailUrl } : {}),
    ...(created ? { created } : {}),
    ...(modified ? { modified } : {}),
    keywords: normaliseKeywords((core.keywords ?? []).sort((a, b) => a.localeCompare(b))),
    exif: readExif(core, doc.geoRef, dataset),
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
): { subject: string; photo: Photo }[] {
  documentUrl(itemUrl);
  const subjects = new Set<string>();
  for (const quad of dataset.match(null, DataFactory.namedNode(RDF_TYPE))) {
    if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
  }
  return [...subjects].sort().flatMap((subject) => {
    const core =
      entities.Photograph.parse(subject, dataset) ?? entities.ImageObject.parse(subject, dataset);
    const photo = core ? photoFromCore(dataset, httpIri(subject), core) : undefined;
    return photo ? [{ subject, photo }] : [];
  });
}
