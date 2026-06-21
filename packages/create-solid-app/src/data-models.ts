// AUTHORED-BY Claude Opus 4.8
/**
 * data-models.ts — the "pick a data model → bound component" catalog for the
 * create-solid-app scaffolder.
 *
 * The maintainer's framing: when scaffolding, let the user choose a data model
 * (task / contact / bookmark / profile / collection / generic solid-view) and
 * the generator emits the matching @jeswr/solid-components bound element in the
 * starter page — a few lines of declarative markup, no hand-rolled LDP/RDF.
 *
 * This is the SINGLE SOURCE OF TRUTH for the mapping, consumed by:
 *  - bin.ts (the `--data-model` flag + its help/validation), and
 *  - scaffold.ts (the substitution that rewrites the template's PodDataView.tsx).
 * Keeping it here means the CLI flag values, the help text, and the emitted JSX
 * can never drift apart.
 *
 * Every model maps to a READ-ONLY Phase-1 element (the package's write/edit path
 * is Phase 2 — see the @jeswr/solid-components README "Out of scope"). The
 * DEFAULT is `solid-view`, the resolve-by-type composer, which reads the
 * resource's rdf:type and mounts the right element itself (so the default works
 * for any pod resource without the user having to know its class).
 */

/** A scaffoldable data model → its bound @jeswr/solid-components element. */
export interface DataModelEntry {
  /** The CLI value (`--data-model <key>`). */
  readonly key: string;
  /** The custom-element tag the starter page mounts. */
  readonly tag: string;
  /** A one-line human label (help text + the generated card title). */
  readonly label: string;
  /**
   * The card description shown in the generated PodDataView. Plain text (it is
   * embedded as JSX text), referencing the chosen element so the value is clear.
   */
  readonly description: string;
  /**
   * The JSX expression the generated element's `src` is bound to. A profile card
   * binds a WebID PROFILE document, so it reads `webId`; every other element reads
   * a container/resource off the pod, so it reads the pod `storage` root. This is a
   * fixed token from the trusted catalog (one of `"storage"` / `"webId"`), spliced
   * verbatim into `src={…}` — never user input. The values it names are the locals
   * the template's `PodDataView` already destructures (`storage`, `webId`).
   */
  readonly srcExpr: "storage" | "webId";
}

/**
 * The catalog. `solid-view` is first + the DEFAULT (the resolve-by-type
 * composer). The rest are the per-class read elements from
 * @jeswr/solid-components Phase 1, each binding one RDF class.
 */
export const DATA_MODELS: readonly DataModelEntry[] = [
  {
    key: "solid-view",
    tag: "solid-view",
    label: "Generic resolve-by-type view (reads rdf:type, picks the right element)",
    description:
      "Rendered declaratively with <solid-view> — it reads the resource's rdf:type and mounts the matching typed element (or a plain container listing for an untyped container). No hand-rolled LDP or RDF.",
    srcExpr: "storage",
  },
  {
    key: "task",
    tag: "jeswr-task-list",
    label: "Task list (wf:Task — title, state, assignee, priority, due date)",
    description:
      "Rendered declaratively with <jeswr-task-list> — every wf:Task in the resource (title, open/closed, assignee, priority, due date). No hand-rolled LDP or RDF.",
    srcExpr: "storage",
  },
  {
    key: "contact",
    tag: "jeswr-contact-list",
    label: "Contact list (vcard:Individual — name, org, emails, phones, WebID)",
    description:
      "Rendered declaratively with <jeswr-contact-list> — every vcard:Individual in the resource (name, org, emails, phones, WebID, note). No hand-rolled LDP or RDF.",
    srcExpr: "storage",
  },
  {
    key: "bookmark",
    tag: "jeswr-bookmark-list",
    label: "Bookmark list (book:Bookmark — title→url link, description, tags)",
    description:
      "Rendered declaratively with <jeswr-bookmark-list> — every book:Bookmark in the resource (title→url link, description, tags, archived). No hand-rolled LDP or RDF.",
    srcExpr: "storage",
  },
  {
    key: "profile",
    tag: "jeswr-profile-card",
    label: "Profile card (a WebID profile — name, photo, org/role, homepage)",
    description:
      "Rendered declaratively with <jeswr-profile-card> — a WebID profile (name, photo, org/role, homepage, WebID, OIDC issuer). No hand-rolled LDP or RDF.",
    // A profile card binds the WebID PROFILE document, not the pod storage container.
    srcExpr: "webId",
  },
  {
    key: "collection",
    tag: "jeswr-collection",
    label: "Container listing (ldp:Container — the ldp:contains children)",
    description:
      "Rendered declaratively with <jeswr-collection> — the ldp:contains children of an LDP container (with an optional type-index label seam). No hand-rolled LDP or RDF.",
    srcExpr: "storage",
  },
] as const;

/** The default model key when `--data-model` is not given. */
export const DEFAULT_DATA_MODEL = "solid-view";

/** Look up a catalog entry by its CLI key (undefined for an unknown key). */
export function findDataModel(key: string): DataModelEntry | undefined {
  return DATA_MODELS.find((m) => m.key === key);
}

/** The list of valid CLI keys (for help text + validation messages). */
export function dataModelKeys(): string[] {
  return DATA_MODELS.map((m) => m.key);
}
