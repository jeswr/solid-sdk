// AUTHORED-BY Claude Opus 4.8
/**
 * The generation pipeline (design §3): ontology + SHACL profile + codegen config →
 * [L0] adapt → [L1] admission (tier-a) → [L2] parse + skolemize shapes → compile
 * the manifest → assert FIDELITY (P0 exit) → emit the artifacts + a hash-pinned
 * codegen manifest. Pure over its string inputs (deterministic): the same inputs +
 * generator produce byte-identical outputs.
 */

import { createHash } from "node:crypto";
import type { ModelManifest } from "@jeswr/model-runtime";
import { RUNTIME_MAJOR } from "@jeswr/model-runtime";
import { type NormalizedOntology, type OntologyAdapter, owlRdfsAdapter } from "./adapter.js";
import { AdmissionError, type AdmissionReport, admit } from "./admission.js";
import { compileManifest } from "./compile.js";
import type { CodegenConfig } from "./config.js";
import { emitModelDts, emitModelJs, emitModelJson, emitShapesTtl } from "./emit.js";
import { assertFidelity } from "./fidelity.js";
import { deriveNodeViews } from "./nodeviews.js";
import { parseTurtle, SH } from "./rdf.js";
import { parseShapes } from "./shapes.js";

/** The generator artifact identity recorded in the codegen manifest. */
export const GENERATOR = { name: "@jeswr/federation-codegen", specVersion: "1" } as const;

export interface GenerateInput {
  /** The sector ontology (OWL/RDFS) as Turtle. */
  ontologyTtl: string;
  /** The SHACL profile as Turtle. */
  shapesTtl: string;
  /** The per-domain codegen config. */
  config: CodegenConfig;
  /** Base IRI for parsing (rarely needed for absolute-IRI ontologies). */
  baseIri?: string;
  /** The L0 adapter (defaults to the committed OWL/RDFS V1 adapter). */
  adapter?: OntologyAdapter;
  /** Override the admission namespace (defaults to the ontology's preferred namespace). */
  admissionNamespace?: string;
  /**
   * Proceed even when admission fails — for demonstrating a sector's coverage gap.
   * The admission report is always returned; NEVER set this in a production build.
   */
  allowUnadmitted?: boolean;
}

export interface GenerateResult {
  /** filename → content, for the generated output directory. */
  artifacts: Record<string, string>;
  admission: AdmissionReport;
  manifest: ModelManifest;
  ontology: NormalizedOntology;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function emitCodegenManifest(
  input: GenerateInput,
  adapter: OntologyAdapter,
  outputs: Record<string, string>,
): string {
  const configJson = JSON.stringify(input.config);
  const manifest = {
    generator: GENERATOR,
    adapter: adapter.name,
    runtime: { name: "@jeswr/model-runtime", major: RUNTIME_MAJOR },
    inputs: {
      "ontology.ttl": sha256(input.ontologyTtl),
      "shapes.shacl.ttl": sha256(input.shapesTtl),
      "codegen.config.json": sha256(configJson),
    },
    outputs: Object.fromEntries(
      Object.keys(outputs)
        .sort()
        .map((k) => [k, sha256(outputs[k] as string)]),
    ),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Run the full pipeline. Throws {@link AdmissionError} / FidelityError fail-closed. */
export function generateModel(input: GenerateInput): GenerateResult {
  const adapter = input.adapter ?? owlRdfsAdapter;

  // [L0] adapt the ontology into the normalized description.
  const ontologyQuads = parseTurtle(input.ontologyTtl, input.baseIri);
  const ontology = adapter.adapt(ontologyQuads);

  // [L2] parse + skolemize the SHACL profile (the stable waist).
  const shapes = parseShapes(input.shapesTtl, input.config.shapesBase);

  // [L1] tier-a admission (fail-closed unless explicitly demonstrating a gap).
  const namespace = input.admissionNamespace ?? ontology.namespace ?? "";
  const admission = admit(ontology, shapes, namespace);
  if (!admission.ok && !input.allowUnadmitted) {
    throw new AdmissionError(admission.violations);
  }

  // Compile the manifest, then assert FIDELITY (the P0 exit criterion).
  const compiled = compileManifest(shapes, input.config);
  assertFidelity(shapes, compiled);

  // Derive the composite per-node views (a pure projection of the fidelity-asserted
  // manifest; `undefined` when the manifest has no composite entity).
  const nodeViews = deriveNodeViews(compiled.manifest);

  // Emit the generated artifacts. shapes.ttl carries the SHACL + skolem-shape
  // prefixes on top of the domain prefixes; the manifest keeps the clean set.
  const shapesPrefixes = { ...input.config.prefixes, sh: SH, shapes: input.config.shapesBase };
  const artifacts: Record<string, string> = {
    "shapes.ttl": emitShapesTtl(shapes, shapesPrefixes),
    "model.json": emitModelJson(compiled.manifest),
    "model.js": emitModelJs(compiled.manifest, nodeViews),
    "model.d.ts": emitModelDts(compiled.manifest, nodeViews),
  };
  artifacts["codegen-manifest.json"] = emitCodegenManifest(input, adapter, artifacts);

  return { artifacts, admission, manifest: compiled.manifest, ontology };
}

/** The Mode-A input lockfile content (sha256 of every fetched/read input). */
export function emitLockfile(
  input: GenerateInput,
  adapter: OntologyAdapter = owlRdfsAdapter,
): string {
  const lock = {
    lockfileVersion: 1,
    generator: GENERATOR,
    adapter: adapter.name,
    inputs: {
      "ontology.ttl": sha256(input.ontologyTtl),
      "shapes.shacl.ttl": sha256(input.shapesTtl),
      "codegen.config.json": sha256(JSON.stringify(input.config)),
    },
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}
