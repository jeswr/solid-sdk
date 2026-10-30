// AUTHORED-BY Codex GPT-6.1-Sol
import { FEDERATION } from "../core/federation-vocab.js";
import { createFileVocabMap } from "../core/file-vocab-map.js";
import { CLASSES } from "../core/vocab.js";

/** Sector classes and required properties supplement the legacy source fields. */
export const vocabMap = createFileVocabMap({
  [CLASSES.Message]: FEDERATION.Note,
});
