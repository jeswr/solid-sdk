// AUTHORED-BY Claude Opus 5.5
import { FEDERATION } from "../core/federation-vocab.js";
import { createFileVocabMap } from "../core/file-vocab-map.js";
import { CLASSES } from "../core/vocab.js";

/** The same sector mapping as WhatsApp: chat messages are social notes. */
export const vocabMap = createFileVocabMap({
  [CLASSES.Message]: FEDERATION.Note,
});
