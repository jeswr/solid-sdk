// AUTHORED-BY Codex GPT-6
import {
  addMeasurement,
  emptyHealthDocument,
  importAppleHealth,
  type Measurement,
  monthKey,
  type Precondition,
} from "../model";
import { type HealthStore, readShard } from "./metrics";

export interface ImportProgress {
  samplesRead: number;
  samplesWritten: number;
  shardsWritten: number;
  counts: Record<string, number>;
  start: string | null;
  end: string | null;
}
export class PartialImportError extends Error {
  constructor(
    readonly progress: ImportProgress,
    readonly cause: unknown,
  ) {
    super(
      `Import stopped. ${progress.samplesWritten} measurements saved in ${progress.shardsWritten} shard writes. Saved measurements are kept. When choosing a different file, include only the remaining records.`,
    );
  }
}
/** Bounded batches; unknown RDF and existing samples survive every conditional write. */
export async function writeSamples(
  store: HealthStore,
  samples: readonly Measurement[],
  owner: string,
  onShard: (count: number) => void,
) {
  await store.initialize();
  const groups = new Map<string, Measurement[]>();
  for (const sample of samples) {
    const key = monthKey(sample.at);
    const group = groups.get(key);
    if (group) group.push(sample);
    else groups.set(key, [sample]);
  }
  for (const [key, group] of groups) {
    const path = `observations/${key}.ttl`;
    const existing = await readShard(store, path);
    const document = existing?.document ?? emptyHealthDocument();
    let condition: Precondition = { create: true };
    if (existing) {
      if (!existing.etag) throw new TypeError("A strong ETag is required");
      condition = { etag: existing.etag };
    }
    for (const sample of group) {
      const iri = `${store.base}${path}#${sample.iri.split("#").at(-1)}`;
      addMeasurement(document, { ...sample, iri });
      document.observation(iri).patient = owner;
    }
    await store.write(path, document, condition);
    onShard(group.length);
  }
}
export async function importHealth(
  store: HealthStore,
  owner: string,
  chunks: AsyncIterable<string>,
  options: { preview: boolean; id: string; onProgress?: (progress: ImportProgress) => void },
) {
  const progress: ImportProgress = {
    samplesRead: 0,
    samplesWritten: 0,
    shardsWritten: 0,
    counts: {},
    start: null,
    end: null,
  };
  let batch: Measurement[] = [];
  const report = () => options.onProgress?.({ ...progress, counts: { ...progress.counts } });
  const flush = async () => {
    await writeSamples(store, batch, owner, (count) => {
      progress.samplesWritten += count;
      progress.shardsWritten++;
      report();
    });
    batch = [];
  };
  try {
    for await (const sample of importAppleHealth(
      chunks,
      (index) => `${store.base}observations/import#${options.id}-${index}`,
    )) {
      progress.samplesRead++;
      progress.counts[sample.kind] = (progress.counts[sample.kind] ?? 0) + 1;
      const date = sample.at.toISOString();
      if (progress.start === null || date < progress.start) progress.start = date;
      if (progress.end === null || date > progress.end) progress.end = date;
      if (!options.preview) {
        batch.push(sample);
        if (batch.length === 250) await flush();
      }
      report();
    }
    if (batch.length) await flush();
    return progress;
  } catch (error) {
    throw new PartialImportError({ ...progress, counts: { ...progress.counts } }, error);
  }
}
