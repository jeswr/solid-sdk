// AUTHORED-BY Claude Opus 5.5
// The decision record: an append-only, hash-chained log of every call the agent made and
// what the gate decided. Each entry carries the digest of the rules in force, so a past
// decision can be re-checked against the exact version that applied at the time.
import { digestOf } from "@jeswr/agent-model/core/canonical";
import type { Args, EnforcementMode, GateDecision, Json } from "./types.js";

/** One entry. `hash` covers every other field, including `previous`. */
export interface RecordEntry {
  readonly seq: number;
  readonly at: string;
  readonly mode: EnforcementMode;
  readonly tool: string;
  readonly args: Args;
  readonly decision: GateDecision;
  /** What happened after the decision. */
  readonly result: "ran" | "held" | "stopped" | "failed" | "approved" | "declined";
  /** For approvals and declines: the entry they settle. */
  readonly settles?: number;
  readonly rulesDigest: string;
  readonly labels: readonly string[];
  readonly note?: Json;
  readonly previous: string;
  readonly hash: string;
}

/** Entry content before chaining. */
export type EntryInput = Omit<RecordEntry, "seq" | "previous" | "hash">;

const GENESIS = "sha-256:genesis";

/** An in-memory decision record. */
export class DecisionRecord {
  readonly #entries: RecordEntry[] = [];
  readonly #listeners = new Set<(entry: RecordEntry) => void>();

  /** Append an entry and return it. */
  append(input: EntryInput): RecordEntry {
    const seq = this.#entries.length;
    const previous = this.#entries.at(-1)?.hash ?? GENESIS;
    const body = { ...input, seq, previous };
    const entry: RecordEntry = { ...body, hash: digestOf(toJson(body)) };
    this.#entries.push(entry);
    for (const listener of this.#listeners) listener(entry);
    return entry;
  }

  /** All entries, oldest first. */
  entries(): readonly RecordEntry[] {
    return [...this.#entries];
  }

  /** Subscribe to new entries; returns an unsubscribe function. */
  subscribe(listener: (entry: RecordEntry) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Verify the chain; returns the first broken sequence number, or undefined if intact. */
  static verify(entries: readonly RecordEntry[]): number | undefined {
    let previous = GENESIS;
    for (const [index, entry] of entries.entries()) {
      const { hash, ...body } = entry;
      if (entry.seq !== index || entry.previous !== previous || digestOf(toJson(body)) !== hash)
        return index;
      previous = hash;
    }
    return undefined;
  }
}

/** Drop undefined members so the canonical digest sees plain JSON. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
