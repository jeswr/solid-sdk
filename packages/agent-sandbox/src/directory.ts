// AUTHORED-BY Claude Opus 5.5
// Names for IRIs and the membership of party groups. The gate needs group membership to
// evaluate `recipient isPartOf <group>`; the UI needs names to explain decisions.

/** A trusted snapshot of names and groups. The evaluator never fetches. */
export interface Directory {
  /** Human names for IRIs (systems, people, purposes, regions, groups). */
  readonly names: Readonly<Record<string, string>>;
  /** Party collections: group IRI -> member party IRIs. */
  readonly groups: Readonly<Record<string, readonly string[]>>;
}

/** The last path or fragment segment of an IRI, made readable. */
export function shortName(iri: string): string {
  const tail =
    iri
      .replace(/[#/]+$/, "")
      .split(/[#/:]/)
      .pop() ?? iri;
  return tail
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}

/** A name for an IRI: the directory's, else a readable fragment. */
export function nameOf(directory: Directory, iri: string): string {
  return (Object.hasOwn(directory.names, iri) ? directory.names[iri] : undefined) ?? shortName(iri);
}

/** Resolve a party collection for solid-odrl's `isPartOf`; unknown groups resolve to undefined. */
export function groupResolver(
  directory: Directory,
): (collection: string) => ReadonlySet<string> | undefined {
  return (collection) => {
    const members = Object.hasOwn(directory.groups, collection)
      ? directory.groups[collection]
      : undefined;
    return members ? new Set(members) : undefined;
  };
}

/** Join names as English: "a", "a or b", "a, b or c". */
export function joinNames(names: readonly string[], word: "or" | "and" = "or"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${word} ${names.at(-1)}`;
}
