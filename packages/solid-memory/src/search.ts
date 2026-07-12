// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pure, client-side memory search — NO server FTS, NO vector search.
 *
 * Filters an in-memory array of {@link MemoryData} by a {@link MemorySearchQuery}.
 * Every filter is conjunctive (AND): an absent filter is not applied, so an empty
 * query returns every NON-forgotten memory — soft-forgotten (tombstoned) memories
 * are excluded unless `includeForgotten: true` (an agent must not recall a memory
 * the user asked to forget). This is the phase-1, deterministic recall path
 * (substring + tag/category/agent/conversation/time filters + the forgotten gate)
 * that runs entirely in the client — no QLever / server full-text index (a CORE-PSS
 * change, deliberately out of scope).
 *
 * **The embedding / vector-search seam is M2.** Semantic similarity over the
 * `mem:embeddingRef` sidecars (embed-then-ANN) is the next milestone — it is NOT
 * implemented here. The model carries `embeddingRef` (a pointer to an opaque,
 * WAC-scoped embedding resource) so an M2 vector recall can be layered on without
 * a model change; this module deliberately ships only the deterministic filters.
 */

import type { MemoryData } from "./memory.js";

/**
 * A conjunctive (AND) query over a memory set. Every field is optional; an absent
 * field is not applied, so `{}` matches every NON-forgotten memory — soft-forgotten
 * (tombstoned) memories are excluded unless `includeForgotten: true` is set (see that
 * field). To include them too, use `{ includeForgotten: true }`.
 */
export interface MemorySearchQuery {
  /** Case-insensitive substring over the memory `text`. */
  text?: string;
  /** Tags that must ALL be present in the memory's `keywords` (match-ALL). */
  keywords?: string[];
  /** Category IRIs that must ALL be present in the memory's `categories` (match-ALL). */
  categories?: string[];
  /** The producing agent's WebID — exact match against `attributedTo`. */
  attributedTo?: string;
  /** The generating conversation IRI — exact match against `generatedBy`. */
  generatedBy?: string;
  /** Lower time bound (inclusive) over `created`, falling back to `modified`. */
  since?: Date;
  /** Upper time bound (inclusive) over `created`, falling back to `modified`. */
  until?: Date;
  /**
   * Include soft-forgotten (tombstoned) memories — those carrying a
   * `prov:invalidatedAtTime` (see {@link MemoryData.invalidatedAt}). Default `false`:
   * a forgotten memory is EXCLUDED from results so an agent never recalls a memory
   * the user asked to forget. Set `true` for an audit / "forgotten items" view.
   */
  includeForgotten?: boolean;
}

/** The memory's effective timestamp for time-window filtering: created, else modified. */
function timestampOf(item: MemoryData): Date | undefined {
  return item.created ?? item.modified;
}

/** Does every element of `required` appear in `have`? (match-ALL, empty ⇒ true.) */
function hasAll(have: readonly string[] | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const set = new Set(have ?? []);
  return required.every((r) => set.has(r));
}

/** Does a single memory satisfy every provided filter of `query`? */
function matches(item: MemoryData, query: MemorySearchQuery): boolean {
  // Soft-forgotten (tombstoned) memories are excluded by default — an agent must
  // not recall a memory the user asked to forget. `includeForgotten: true` opts an
  // audit / "forgotten items" view back in.
  if (item.invalidatedAt !== undefined && !query.includeForgotten) return false;
  if (query.text !== undefined) {
    if (!item.text.toLowerCase().includes(query.text.toLowerCase())) return false;
  }
  if (query.keywords !== undefined && !hasAll(item.keywords, query.keywords)) return false;
  if (query.categories !== undefined && !hasAll(item.categories, query.categories)) return false;
  if (query.attributedTo !== undefined && item.attributedTo !== query.attributedTo) return false;
  if (query.generatedBy !== undefined && item.generatedBy !== query.generatedBy) return false;

  if (query.since !== undefined || query.until !== undefined) {
    const ts = timestampOf(item);
    // A memory with no timestamp cannot satisfy a time-window filter.
    if (!ts) return false;
    if (query.since !== undefined && ts.getTime() < query.since.getTime()) return false;
    if (query.until !== undefined && ts.getTime() > query.until.getTime()) return false;
  }
  return true;
}

/**
 * Filter `items` to those matching every provided filter of `query` (AND). Pure:
 * does not mutate `items`. An empty query returns all NON-forgotten items (order
 * preserved); soft-forgotten (tombstoned) items are included only with
 * `includeForgotten: true`.
 */
export function searchMemories(
  items: readonly MemoryData[],
  query: MemorySearchQuery,
): MemoryData[] {
  return items.filter((item) => matches(item, query));
}
