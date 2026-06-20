/**
 * Pure, client-side memory search — NO server FTS, NO vector search.
 *
 * Filters an in-memory array of {@link MemoryData} by a {@link MemorySearchQuery}.
 * Every filter is conjunctive (AND): an absent filter is not applied, an empty
 * query returns everything. This is the phase-1, deterministic recall path
 * (substring + tag/category/agent/conversation/time filters) that runs entirely
 * in the client — no QLever / server full-text index (a CORE-PSS change,
 * deliberately out of scope).
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
 * field is not applied, so `{}` matches everything.
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
}
/**
 * Filter `items` to those matching every provided filter of `query` (AND). Pure:
 * does not mutate `items`. An empty query returns a copy of all items (order
 * preserved).
 */
export declare function searchMemories(items: readonly MemoryData[], query: MemorySearchQuery): MemoryData[];
//# sourceMappingURL=search.d.ts.map