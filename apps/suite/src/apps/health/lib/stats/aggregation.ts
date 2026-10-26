// AUTHORED-BY Codex GPT-6.1-Sol
import { type BucketOptions, createBucketer } from "./buckets";
import { finite } from "./validation";

/** One metric, already normalised to one unit. Instant readings are never duration-weighted. */
export interface Observation {
  readonly timestamp: number;
  readonly value: number;
}
export type Aggregation = "sum" | "mean" | "min" | "max" | "last";
export interface AggregatedBucket {
  readonly key: string;
  readonly value: number;
  readonly count: number;
}

/** Occupied buckets only, ascending by local start date. Does not mutate the input. */
export function aggregateObservations(
  observations: readonly Observation[],
  options: BucketOptions,
  method: Aggregation,
): AggregatedBucket[] {
  if (!["sum", "mean", "min", "max", "last"].includes(method)) {
    throw new RangeError("Unsupported aggregation");
  }
  const keyOf = createBucketer(options);
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    finite(observation.value);
    const key = keyOf(observation.timestamp);
    const group = groups.get(key);
    if (group) group.push(observation);
    else groups.set(key, [observation]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      // Every group is nonempty. Reduce from its first reading, avoiding min/max sentinels.
      const first = group[0] as Observation;
      let value = first.value;
      let latest = first.timestamp;
      for (let i = 1; i < group.length; i++) {
        const reading = group[i] as Observation;
        if (method === "sum" || method === "mean") value = finite(value + reading.value);
        if (method === "min") value = Math.min(value, reading.value);
        if (method === "max") value = Math.max(value, reading.value);
        if (method === "last" && reading.timestamp >= latest) {
          value = reading.value;
          latest = reading.timestamp;
        }
      }
      if (method === "mean") value /= group.length;
      return { key, value, count: group.length };
    });
}
