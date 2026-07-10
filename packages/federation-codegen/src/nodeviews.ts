// AUTHORED-BY Claude Fable
/**
 * COMPOSITE PER-NODE VIEWS — derive, from a compiled (fidelity-asserted) manifest,
 * a second manifest of one FLAT view entity per composite sub-node, so the generated
 * model can expose a typed `@rdfjs/wrapper` Wrapper for EVERY node of a composite
 * (Track / Artist / Album / Instant …), not just the composite's root. This removes
 * the last reason a consumer hand-writes per-node wrapper classes (e.g.
 * solid-listening's `src/nodes.ts`).
 *
 * The derivation is a PURE PROJECTION of the already-fidelity-asserted manifest — it
 * mints no field, guard, or name that the manifest does not carry. It runs at
 * GENERATION time (audited generator code); the generated `model.js` merely inlines
 * the derived manifest as DATA and interprets it through the SAME audited
 * `@jeswr/model-runtime` `defineModel` path as the main manifest, so every view
 * accessor gets the runtime's guard stack (IRI scheme filter, control-char
 * sanitization, fail-closed datatype coercion) for free.
 *
 * Projection rules:
 * - Each composite node becomes a flat view entity named
 *   `<CompositeName><NodeName>Node` (node name capitalised) — collision-checked
 *   fail-closed against the main manifest's entity names and the other views.
 * - A node's flat (`iri` / `literal`) fields are carried VERBATIM (including the
 *   composite's renames — `trackTitle`, not `title`: the rename IS the projection
 *   contract, and per-node views read the same documents the composite writes).
 * - A `nested` link field is projected as a plain single-valued `iri` field (same
 *   name + predicate; a `requiredFailClosed` guard is carried) — the per-node view
 *   is a LOW-LEVEL lens, so a link surfaces as the linked node's IRI, exactly as the
 *   hand-written wrappers exposed it. Cross-node MUST enforcement stays where it
 *   lives: the composite entity's graph-walk `parse`.
 * - The view entity's `subject` convention is a schema-required placeholder (the
 *   runtime's manifest schema only knows `hash-it`/`self`, which cannot express a
 *   node fragment). It is UNUSED: the emitted node handle exposes its own
 *   fragment-correct `subject()`, and only the view's `Wrapper` is ever surfaced —
 *   never the view's `build`/`parse`/`subject`.
 */

import {
  type AnyManifestEntity,
  isCompositeEntity,
  type ManifestEntity,
  type ManifestField,
  type ModelManifest,
  validateManifest,
} from "@jeswr/model-runtime";

/** One node's view — the derived view entity name + the node's fragment/type. */
export interface NodeViewRef {
  /** The derived FLAT view entity's name in the node-views manifest. */
  entity: string;
  /** The node's document fragment — the node IRI is `${resourceUrl}#${fragment}`. */
  fragment: string;
  /** The node's primary `rdf:type` IRI. */
  typeIri: string;
}

/** Composite name → node name → the node's view reference (deterministic order). */
export type NodeViewIndex = Record<string, Record<string, NodeViewRef>>;

/** The derived node-views manifest + the index the emitted handle map is built from. */
export interface NodeViews {
  /** A validated manifest of one FLAT view entity per composite node. */
  manifest: ModelManifest;
  /** Composite name → node name → view reference. */
  index: NodeViewIndex;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Project a node field for the flat view: a `nested` link becomes a plain IRI field. */
function projectField(field: ManifestField): ManifestField {
  if (field.kind !== "nested") return structuredClone(field);
  const projected: ManifestField = {
    name: field.name,
    predicate: field.predicate,
    kind: "iri",
  };
  // The only guard a nested link may carry (the cross-node MUST) — kept so the view
  // stays a faithful projection; it affects only the view's (unexposed) parse.
  if (field.guards?.requiredFailClosed === true) {
    projected.guards = { requiredFailClosed: true };
  }
  return projected;
}

/**
 * Derive the per-node view manifest + index from a compiled manifest, or `undefined`
 * when the manifest has no composite entity (nothing to view). Throws fail-closed on
 * any name collision (a collision would mint an ambiguous entity / duplicate emitted
 * TS interface). The result's manifest is re-validated through the runtime's own
 * fail-closed `validateManifest` before it is returned.
 */
export function deriveNodeViews(manifest: ModelManifest): NodeViews | undefined {
  const composites = manifest.entities.filter(isCompositeEntity);
  if (composites.length === 0) return undefined;

  const mainNames = new Set(manifest.entities.map((e: AnyManifestEntity) => e.name));
  const viewNames = new Set<string>();
  const viewEntities: ManifestEntity[] = [];
  const index: NodeViewIndex = {};

  for (const composite of composites) {
    const nodesOf: Record<string, NodeViewRef> = {};
    for (const node of composite.nodes) {
      const viewName = `${composite.name}${capitalize(node.name)}Node`;
      if (mainNames.has(viewName)) {
        throw new Error(
          `node view "${viewName}" (composite "${composite.name}", node "${node.name}") collides with a manifest entity name — rename the entity or the node`,
        );
      }
      if (viewNames.has(viewName)) {
        throw new Error(
          `node view "${viewName}" (composite "${composite.name}", node "${node.name}") collides with another node view — rename the composite or the node`,
        );
      }
      viewNames.add(viewName);
      viewEntities.push({
        name: viewName,
        typeIris: [...node.typeIris],
        // Schema-required placeholder — unused (see the module doc): only the view's
        // Wrapper is surfaced; the emitted handle carries the fragment-correct subject.
        subject: { convention: "hash-it" },
        fields: node.fields.map(projectField),
      });
      nodesOf[node.name] = {
        entity: viewName,
        fragment: node.fragment,
        typeIri: node.typeIris[0] as string,
      };
    }
    index[composite.name] = nodesOf;
  }

  // Re-validate through the runtime's fail-closed schema (caps, name charset,
  // reserved names) so a derived manifest can never be looser than a compiled one.
  const viewManifest = validateManifest({
    manifestVersion: manifest.manifestVersion,
    runtime: { ...manifest.runtime },
    prefixes: { ...manifest.prefixes },
    entities: viewEntities,
  });

  return { manifest: viewManifest, index };
}
