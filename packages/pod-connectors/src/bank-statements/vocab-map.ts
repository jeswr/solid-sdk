// AUTHORED-BY Codex GPT-6.1-Sol
import { FEDERATION } from "../core/federation-vocab.js";
import { CLASSES } from "../core/vocab.js";
import { createVocabMap } from "../core/vocab-map.js";

/** Sector classes supplement the legacy types; source fields retain their meaning. */
export const vocabMap = createVocabMap({
  [CLASSES.Invoice]: FEDERATION.TransactionRecord,
});
