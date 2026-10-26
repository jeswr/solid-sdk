// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { copyDataset } from "./incremental.js";
import type { VocabMap } from "./types.js";
import { PodThing } from "./vocab.js";

/** Add sector types through typed wrappers without dropping legacy types.
 * Detailed sector property mapping belongs to each adapter's follow-on task.
 */
export function createVocabMap(types: Readonly<Record<string, string>>): VocabMap {
  return (doc) => {
    const dataset = copyDataset(doc.dataset);
    const subjects = new Set(
      [...dataset].filter((q) => q.subject.termType === "NamedNode").map((q) => q.subject.value),
    );
    for (const subject of subjects) {
      const item = new PodThing(subject, dataset, DataFactory);
      for (const [legacy, sector] of Object.entries(types))
        if (item.types.has(legacy)) item.types.add(sector);
    }
    return { ...doc, dataset };
  };
}
