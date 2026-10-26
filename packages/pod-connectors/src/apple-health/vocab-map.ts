// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { FEDERATION } from "../core/federation-vocab.js";
import { copyDataset } from "../core/incremental.js";
import type { VocabMap } from "../core/types.js";
import { CLASSES, PodThing } from "../core/vocab.js";

/** The health document is a record. Workouts remain exercise actions: the
 * sector defines clinical observations, not an equivalent workout event type.
 */
export const vocabMap: VocabMap = (doc) => {
  const dataset = copyDataset(doc.dataset);
  for (const quad of doc.dataset) {
    if (quad.object.value !== CLASSES.ExerciseAction) continue;
    const url = quad.subject.value.split("#")[0] ?? quad.subject.value;
    new PodThing(url, dataset, DataFactory).types.add(FEDERATION.HealthRecord);
    break;
  }
  return { ...doc, dataset };
};
