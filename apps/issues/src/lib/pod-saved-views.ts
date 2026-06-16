// AUTHORED-BY Claude Opus 4.8
/**
 * Pod-backed, shareable saved views — the Jira/Monday "saved filter" hallmark.
 *
 * A saved view (a named filter/sort + active layout) is persisted IN THE TRACKER
 * CONFIG document, not localStorage, so it follows the user across devices and is
 * visible to any collaborator who can read the tracker. The query+layout is
 * stored as an opaque JSON `payload` on a `wf:savedView` node (see `issue.ts`
 * Tracker accessors); this module owns the codec between a render-friendly
 * {@link SavedView} and that payload, plus a thin store over the {@link Repository}.
 *
 * Pod data is untrusted input: {@link parsePayload} validates and clamps every
 * field, so a malformed/hostile payload yields a SAFE default query rather than
 * letting arbitrary shapes into the view state.
 */
import type { Repository } from "./repository";
import type { SavedViewDef } from "./issue";
import { DEFAULT_QUERY, type IssueQuery, type SortDir, type SortKey, type StateFilter } from "./filter";
import { VIEWS, type View } from "./view";
import { PRIORITIES, type Priority } from "./issue";

/** A render-friendly saved view: stable IRI, name, the query, and an optional layout. */
export interface PodSavedView {
  iri: string;
  name: string;
  query: IssueQuery;
  view?: View;
}

const STATES: readonly StateFilter[] = ["open", "closed", "all"];
const SORT_KEYS: readonly SortKey[] = ["created", "updated", "due", "priority", "title"];
const SORT_DIRS: readonly SortDir[] = ["asc", "desc"];
const PRIORITY_SET = new Set<string>(PRIORITIES);

/** A finite array of trimmed, de-duplicated strings (defensive against pod data). */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Serialise a saved view's query + layout into the JSON `payload` stored in the pod. */
export function serializePayload(query: IssueQuery, view?: View): string {
  return JSON.stringify({
    text: query.text,
    state: query.state,
    priorities: query.priorities,
    labels: query.labels,
    assignees: query.assignees,
    sort: query.sort,
    sortDir: query.sortDir,
    ...(view ? { view } : {}),
  });
}

/**
 * Parse a stored `payload` back into a query + optional layout. Every field is
 * validated against its allowed set and falls back to the {@link DEFAULT_QUERY}
 * value if absent or invalid, so an arbitrary/hostile pod payload can never
 * inject an out-of-range value into the view state.
 */
export function parsePayload(payload: string): { query: IssueQuery; view?: View } {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    /* corrupt payload → all defaults */
  }
  const query: IssueQuery = {
    text: typeof raw.text === "string" ? raw.text : DEFAULT_QUERY.text,
    state: STATES.includes(raw.state as StateFilter) ? (raw.state as StateFilter) : DEFAULT_QUERY.state,
    priorities: stringArray(raw.priorities).filter((p) => PRIORITY_SET.has(p)) as Priority[],
    labels: stringArray(raw.labels),
    assignees: stringArray(raw.assignees),
    sort: SORT_KEYS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : DEFAULT_QUERY.sort,
    sortDir: SORT_DIRS.includes(raw.sortDir as SortDir) ? (raw.sortDir as SortDir) : DEFAULT_QUERY.sortDir,
  };
  const view = VIEWS.includes(raw.view as View) ? (raw.view as View) : undefined;
  return { query, ...(view ? { view } : {}) };
}

/** Map a stored {@link SavedViewDef} into a render-friendly {@link PodSavedView}. */
export function toPodSavedView(def: SavedViewDef): PodSavedView {
  return { iri: def.iri, name: def.name, ...parsePayload(def.payload) };
}

/**
 * Pod-backed saved-view store: lists / saves / removes views persisted in the
 * tracker config via the {@link Repository}. Saving by an existing name
 * overwrites that view (by its IRI) rather than creating a duplicate — matching
 * the localStorage store's name-dedupe behaviour.
 */
export class PodSavedViews {
  constructor(private readonly repo: Repository) {}

  /** All saved views on the tracker, name-sorted. */
  async list(): Promise<PodSavedView[]> {
    return (await this.repo.savedViews()).map(toPodSavedView);
  }

  /**
   * Save a view. If one already exists with the same (trimmed) name, it is
   * overwritten in place (keeps a stable IRI); otherwise a fresh one is minted.
   * Returns the stored view.
   */
  async save(name: string, query: IssueQuery, view?: View): Promise<PodSavedView> {
    const trimmed = name.trim();
    const existing = (await this.repo.savedViews()).find((v) => v.name === trimmed);
    const def = await this.repo.defineSavedView(trimmed, serializePayload(query, view), existing?.iri);
    return toPodSavedView(def);
  }

  /** Remove a saved view by its IRI. */
  async remove(iri: string): Promise<void> {
    await this.repo.removeSavedView(iri);
  }
}
