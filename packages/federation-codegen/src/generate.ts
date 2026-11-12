// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Claude Opus 5.5
/**
 * The generation pipeline (design §3): ontology + SHACL profile + codegen config →
 * [L0] adapt → [L1] admission (tier-a) → [L2] parse + skolemize shapes → compile
 * the manifest → assert FIDELITY (P0 exit) → emit the artifacts + a hash-pinned
 * codegen manifest. Pure over its string inputs (deterministic): the same inputs +
 * generator produce byte-identical outputs.
 */

import { createHash } from "node:crypto";
import type { ManifestField, ModelManifest } from "@jeswr/model-runtime";
import { isCompositeEntity, RUNTIME_MAJOR } from "@jeswr/model-runtime";
import { type NormalizedOntology, type OntologyAdapter, owlRdfsAdapter } from "./adapter.js";
import { AdmissionError, type AdmissionReport, admit } from "./admission.js";
import { compileManifest } from "./compile.js";
import { type CodegenConfig, validateConfig } from "./config.js";
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
  /**
   * The committed `model.json` from the previous generation, when one exists. A field
   * that was a closed concept enumeration there (`guards.iriEnum`) must still be one:
   * an advisory `sh:class` otherwise silently loses all runtime enforcement when the
   * ontology loses its last named individual of the class. Remove the committed
   * model.json to accept such a loosening deliberately.
   */
  previousManifest?: string;
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

/**
 * Scalar fields by entity, composite node (if any) and predicate: whether each is a
 * concept enum. A nested link is enforced structurally, so it is not "unenforced".
 */
function conceptEnumFields(manifest: ModelManifest): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const add = (owner: string[], fields: ManifestField[] | undefined) => {
    for (const field of Array.isArray(fields) ? fields : [])
      if (field?.kind !== "nested")
        out.set(JSON.stringify([...owner, field?.predicate]), field?.guards?.iriEnum === true);
  };
  for (const entity of manifest.entities) {
    if (isCompositeEntity(entity))
      for (const node of Array.isArray(entity.nodes) ? entity.nodes : [])
        add([entity.name, node?.name], node?.fields);
    else add([entity.name], entity?.fields);
  }
  return out;
}

/** A field strict in the committed manifest never silently becomes unenforced. */
function assertConceptEnumsRetained(previous: string, manifest: ModelManifest): void {
  let previousFields: Map<string, boolean>;
  try {
    const parsed = JSON.parse(previous) as ModelManifest;
    if (
      !Array.isArray(parsed?.entities) ||
      parsed.entities.some((e) => typeof e !== "object" || e === null)
    )
      throw new TypeError("no entities");
    previousFields = conceptEnumFields(parsed);
  } catch {
    throw new AdmissionError([
      {
        code: "unstable-concept-enum",
        severity: "error",
        subject: "model.json",
        message: "the committed model.json is not a readable manifest",
      },
    ]);
  }
  const current = conceptEnumFields(manifest);
  const lost = [...previousFields]
    .filter(([key, strict]) => strict && current.get(key) === false)
    .map(([key]) => (JSON.parse(key) as string[]).join(" "));
  if (lost.length)
    throw new AdmissionError(
      lost.map((subject) => ({
        code: "unstable-concept-enum",
        severity: "error" as const,
        subject,
        message:
          "field was a closed concept enumeration in the committed model.json and would no longer be enforced; remove the committed model.json to accept this deliberately",
      })),
    );
}

/** Run the full pipeline. Throws {@link AdmissionError} / FidelityError fail-closed. */
export function generateModel(input: GenerateInput): GenerateResult {
  validateConfig(input.config);
  const adapter = input.adapter ?? owlRdfsAdapter;

  // [L0] adapt the ontology into the normalized description.
  const ontologyQuads = parseTurtle(input.ontologyTtl, input.baseIri);
  const ontology = adapter.adapt(ontologyQuads);

  // [L2] parse + skolemize the SHACL profile (the stable waist).
  const shapes = parseShapes(
    input.shapesTtl,
    input.config.shapesBase,
    ontology,
    ontologyQuads,
    input.config,
  );

  // [L1] tier-a admission (fail-closed unless explicitly demonstrating a gap).
  const namespace = input.admissionNamespace ?? ontology.namespace ?? "";
  const admission = admit(ontology, shapes, namespace, input.config);
  if (!admission.ok && !input.allowUnadmitted) {
    throw new AdmissionError(admission.violations);
  }

  // Compile the manifest, then assert FIDELITY (the P0 exit criterion).
  const compiled = compileManifest(shapes, input.config);
  assertFidelity(shapes, compiled);
  if (input.previousManifest !== undefined)
    assertConceptEnumsRetained(input.previousManifest, compiled.manifest);

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
