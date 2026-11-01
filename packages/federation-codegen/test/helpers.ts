// AUTHORED-BY Claude Opus 4.8
//
// Test helper — narrow a manifest entity to a FLAT entity. Since the manifest entity
// type became a `flat | composite` union (Phase M), tests that build FLAT models narrow
// through this so `.fields` / `.typeIris` type-check without a per-line guard.
import {
  type AnyManifestEntity,
  isCompositeEntity,
  type ManifestEntity,
} from "@jeswr/model-runtime";

/** Narrow (or throw) a manifest entity to the FLAT variant. */
export function flat(entity: AnyManifestEntity | undefined): ManifestEntity {
  if (entity === undefined || isCompositeEntity(entity)) {
    throw new Error("expected a flat manifest entity");
  }
  return entity;
}
