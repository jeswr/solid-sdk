// AUTHORED-BY Claude Opus 5.5
import { FEDERATION } from "../core/federation-vocab.js";
import { createFileVocabMap } from "../core/file-vocab-map.js";
import { CLASSES } from "../core/vocab.js";

/** Viewings are media activities (as Netflix's); films are creative works (as books). */
export const vocabMap = createFileVocabMap({
  [CLASSES.WatchAction]: FEDERATION.ListeningActivity,
  [CLASSES.Movie]: FEDERATION.CreativeWork,
});
