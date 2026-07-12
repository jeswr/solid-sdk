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
export declare const RESOLVER_ENTRIES: readonly ComponentEntry[];
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
export declare function resolveComponent(types: Iterable<string>, options?: ResolveComponentOptions): ComponentEntry | undefined;
/**
 * Resolve a single class IRI directly (the codegen "I already know the class" path),
 * honouring the same `mode` filter. A thin lookup over the by-class index, falling
 * back to the priority resolver only when a class appears in several entries.
 */
export declare function resolveComponentForClass(targetClass: string, options?: ResolveComponentOptions): ComponentEntry | undefined;
/**
 * Collect the `rdf:type` IRIs of `subject` from a dataset (a direct quad scan — no
 * typed accessor, no triple built), mirroring PM's `collectTypes`. When `subject` is
 * omitted, collect EVERY `rdf:type` object in the dataset (useful when the primary
 * subject IRI is not known up front — `<solid-view>` then resolves on the union).
 *
 * The dataset is duck-typed to the RDF/JS `match`-able / iterable surface so this
 * works against an n3 `Store` OR any `DatasetCore` without importing n3 here.
 */
export declare function collectTypes(dataset: TypeScanDataset, subject?: string): Set<string>;
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
export {};
