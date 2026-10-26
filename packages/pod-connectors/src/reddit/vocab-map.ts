// AUTHORED-BY Codex GPT-6.1-Sol

import { FEDERATION } from "../core/federation-vocab.js";
import { CLASSES } from "../core/vocab.js";
import { createVocabMap } from "../core/vocab-map.js";

/** Adapter-local sector mapping seam; retain schema.org/FOAF types. */
export const vocabMap = createVocabMap({
  [CLASSES.SocialMediaPosting]: FEDERATION.Note,
});
