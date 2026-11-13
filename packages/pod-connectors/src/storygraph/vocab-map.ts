// AUTHORED-BY Claude Opus 5.5
import { FEDERATION } from "../core/federation-vocab.js";
import { createFileVocabMap } from "../core/file-vocab-map.js";
import { CLASSES } from "../core/vocab.js";

/** The same sector mapping as Goodreads: books are media creative works. */
export const vocabMap = createFileVocabMap({
  [CLASSES.Book]: FEDERATION.CreativeWork,
});
