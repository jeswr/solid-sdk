// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// resolveComponent + the committed static resolver map — "given an RDF class (or a
// resource's rdf:type set), which custom element renders it?" — the runtime half of
// the codegen contract the CEM advertises.
//
// THE MAP IS THE RUNTIME SOURCE OF TRUTH (zero network). It is a hand-committed
// `{ targetClass -> { tagName, importSpec, mode } }` table whose edges MIRROR the
// `@solid-class` JSDoc tags on the components (a CEM-accuracy test asserts the map
// and the generated `custom-elements.json` agree, so the map can't silently drift
// from the manifest). The `solidcomp:` RDF projection of this map is OPTIONAL /
// deferred — the static map is what `<solid-view>` consults at runtime.
//
// THE SELECTION LOGIC IS EXTRACTED FROM POD-MANAGER, NOT REINVENTED. PM already
// solves "rdf:type set → which typed view" in
// `solid-pod-manager/src/lib/typed-views/select.ts`:
//   - `collectTypes(dataset)` scans the dataset for `rdf:type` NamedNode objects
//     into a `Set<string>` (a direct quad scan — no typed accessor);
//   - `selectTypedViewer(ctx)` iterates a priority-ranked registry, takes the
//     highest-priority `matches()` (ties → earliest registration), else `undefined`
//     (the caller falls back to a generic RDF table).
// We keep the SAME shape here, thinned to a static map: `collectTypes` is the same
// rdf:type scan; `resolveComponent` is `selectTypedViewer` over the static entries
// (priority + first-registered tie-break + undefined fallback). We do NOT stand up a
// parallel registry abstraction — the map IS the registry, and the resolver is the
// one selection function over it.

import { LDP_BASIC_CONTAINER, LDP_CONTAINER, RDF_TYPE } from "./vocab.js";

/** How an element renders the class — view (read) or edit (write; Phase-2). */
export type ComponentMode = "view" | "edit";

/** One resolver entry: the element that renders a target RDF class. */
export interface ComponentEntry {
  /** The bound RDF class IRI (the `@solid-class` tag / `sh:targetClass`). */
  readonly targetClass: string;
  /** The custom-element tag name (`customElements.get(tagName)`). */
  readonly tagName: string;
  /**
   * The module specifier whose side-effect import REGISTERS the element. `<solid-view>`
   * lazy-imports this before mounting `tagName`. A bare package subpath so a consumer
   * resolves it (and a bundler can code-split on it).
   */
  readonly importSpec: string;
  /** Whether the element renders (`view`) or edits (`edit`) the class. */
  readonly mode: ComponentMode;
  /**
   * Higher wins when a resource carries several matching `rdf:type`s. Ties break by
   * registration order (earliest first) — exactly PM's `selectTypedViewer` rule.
   * Container-level classes (book/contacts) outrank the generic LDP container so a
   * typed container renders with its typed element, not the bare listing.
   */
  readonly priority: number;
}

/**
 * THE COMMITTED STATIC RESOLVER MAP — `targetClass -> ComponentEntry`. The codegen
 * contract's runtime table; mirrors the `@solid-class` tags in the CEM. Ordered most-
 * to-least specific (the order is the tie-break for equal priority). The `importSpec`
 * is always the package ROOT (`@jeswr/solid-components`): importing it side-effect-
 * registers EVERY element (each component module self-registers + the barrel imports
 * them all), so a single dynamic import covers any resolved tag. A future build could
 * split per-element specifiers; the root spec is correct + buildless today.
 */
export const RESOLVER_ENTRIES: readonly ComponentEntry[] = [
  {
    targetClass: "http://www.w3.org/2005/01/wf/flow#Task",
    tagName: "jeswr-task-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70,
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#AddressBook",
    tagName: "jeswr-contact-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70,
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#Individual",
    tagName: "jeswr-contact-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 65,
  },
  {
    targetClass: "https://w3id.org/jeswr/bookmark#Bookmark",
    tagName: "jeswr-bookmark-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70,
  },
  // The generic LDP container listing — LOWEST priority so a typed container (an
  // AddressBook, a bookmarks container that ALSO types ldp:Container) renders with
  // its typed element, and only an UNtyped container falls through to the listing.
  {
    targetClass: LDP_CONTAINER,
    tagName: "jeswr-collection",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 10,
  },
  {
    targetClass: LDP_BASIC_CONTAINER,
    tagName: "jeswr-collection",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 10,
  },

  // ── Phase-2 EDIT-mode entries — the per-class editable forms. A consumer asks
  // the resolver for `{ mode: "edit" }` to get the FORM element for a class (e.g.
  // <solid-view mode="edit">). Same target classes as the view entries; the `mode`
  // filter selects between the read element + the form. Priorities mirror the view
  // entries so the same specificity ordering applies within the edit mode.
  {
    targetClass: "http://www.w3.org/2005/01/wf/flow#Task",
    tagName: "jeswr-task-form",
    importSpec: "@jeswr/solid-components",
    mode: "edit",
    priority: 70,
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#Individual",
    tagName: "jeswr-contact-form",
    importSpec: "@jeswr/solid-components",
    mode: "edit",
    priority: 65,
  },
  {
    targetClass: "https://w3id.org/jeswr/bookmark#Bookmark",
    tagName: "jeswr-bookmark-form",
    importSpec: "@jeswr/solid-components",
    mode: "edit",
    priority: 70,
  },
];

/** A fast `targetClass -> entry` index over {@link RESOLVER_ENTRIES} (first wins). */
const BY_CLASS: ReadonlyMap<string, ComponentEntry> = (() => {
  const m = new Map<string, ComponentEntry>();
  for (const e of RESOLVER_ENTRIES) if (!m.has(e.targetClass)) m.set(e.targetClass, e);
  return m;
})();

/** Options for {@link resolveComponent}. */
export interface ResolveComponentOptions {
  /** Only resolve an entry whose mode matches (e.g. `"view"` in Phase-1). */
  readonly mode?: ComponentMode;
}

/**
 * Resolve the best {@link ComponentEntry} for a set of `rdf:type` IRIs, or
 * `undefined` when none binds (the caller falls back to `<jeswr-collection>` /
 * `<jeswr-shacl-view>` / a generic view). The selection rule is PM's
 * `selectTypedViewer`, thinned over the static map: among the entries whose
 * `targetClass` is in `types`, take the highest `priority`; ties break by earliest
 * registration order in {@link RESOLVER_ENTRIES}.
 *
 * @param types - the resource's `rdf:type` IRIs (e.g. from {@link collectTypes}).
 * @param options - an optional `mode` filter.
 */
export function resolveComponent(
  types: Iterable<string>,
  options: ResolveComponentOptions = {},
): ComponentEntry | undefined {
  const wanted = new Set(types);
  let best: { entry: ComponentEntry; index: number } | undefined;
  RESOLVER_ENTRIES.forEach((entry, index) => {
    if (!wanted.has(entry.targetClass)) return;
    if (options.mode && entry.mode !== options.mode) return;
    if (
      best === undefined ||
      entry.priority > best.entry.priority ||
      // equal priority → keep the earlier registration (lower index), PM's tie-break.
      (entry.priority === best.entry.priority && index < best.index)
    ) {
      best = { entry, index };
    }
  });
  return best?.entry;
}

/**
 * Resolve a single class IRI directly (the codegen "I already know the class" path),
 * honouring the same `mode` filter. A thin lookup over the by-class index, falling
 * back to the priority resolver only when a class appears in several entries.
 */
export function resolveComponentForClass(
  targetClass: string,
  options: ResolveComponentOptions = {},
): ComponentEntry | undefined {
  const direct = BY_CLASS.get(targetClass);
  if (direct && (!options.mode || direct.mode === options.mode)) return direct;
  // Fall through the full resolver in case the same class has a mode-specific entry.
  return resolveComponent([targetClass], options);
}

/**
 * Collect the `rdf:type` IRIs of `subject` from a dataset (a direct quad scan — no
 * typed accessor, no triple built), mirroring PM's `collectTypes`. When `subject` is
 * omitted, collect EVERY `rdf:type` object in the dataset (useful when the primary
 * subject IRI is not known up front — `<solid-view>` then resolves on the union).
 *
 * The dataset is duck-typed to the RDF/JS `match`-able / iterable surface so this
 * works against an n3 `Store` OR any `DatasetCore` without importing n3 here.
 */
export function collectTypes(dataset: TypeScanDataset, subject?: string): Set<string> {
  const types = new Set<string>();
  for (const quad of iterateQuads(dataset)) {
    if (quad.predicate?.value !== RDF_TYPE) continue;
    if (quad.object?.termType !== "NamedNode") continue;
    const objectValue = quad.object.value;
    if (objectValue === undefined) continue;
    if (subject !== undefined && quad.subject?.value !== subject) continue;
    types.add(objectValue);
  }
  return types;
}

/** A minimal RDF term shape (just the fields the type scan reads). */
interface ScanTerm {
  readonly termType?: string;
  readonly value?: string;
}

/** A minimal quad shape for the type scan. */
interface ScanQuad {
  readonly subject?: ScanTerm;
  readonly predicate?: ScanTerm;
  readonly object?: ScanTerm;
}

/** The dataset surface {@link collectTypes} accepts — an iterable of quads. */
export type TypeScanDataset = Iterable<ScanQuad>;

/** Iterate a dataset's quads via its iterable protocol (n3 Store + DatasetCore both are). */
function iterateQuads(dataset: TypeScanDataset): Iterable<ScanQuad> {
  return dataset;
}
