// AUTHORED-BY Codex (GPT-6.1 Sol)
import { Store } from "n3";
import { DCT, EXIF, GEO, RDF_TYPE, SCHEMA } from "./vocab.js";

/** Keep the original facade's property and Turtle order after generated builds. */
export function orderedStore(dataset: Store, predicates: string[]): Store {
  const rank = new Map(predicates.map((predicate, index) => [predicate, index]));
  return new Store(
    [...dataset].sort((a, b) =>
      a.subject.equals(b.subject)
        ? (rank.get(a.predicate.value) ?? predicates.length) -
          (rank.get(b.predicate.value) ?? predicates.length)
        : 0,
    ),
  );
}

export const PHOTO_PREDICATE_ORDER = [
  RDF_TYPE,
  ...["name", "description", "contentUrl", "thumbnailUrl"].map((name) => `${SCHEMA}${name}`),
  `${DCT}created`,
  `${DCT}modified`,
  `${SCHEMA}keywords`,
  ...[
    "make",
    "model",
    "lensModel",
    "focalLength",
    "fNumber",
    "exposureTime",
    "isoSpeedRatings",
    "orientation",
  ].map((name) => `${EXIF}${name}`),
  ...["width", "height", "dateCreated", "geo"].map((name) => `${SCHEMA}${name}`),
  `${GEO}lat`,
  `${GEO}long`,
];
