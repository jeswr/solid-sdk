// AUTHORED-BY GPT-5.6 Sol via codex

import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { generateCore } from "./generate.js";
import type {
  SyntheticRdfOptions,
  SyntheticRdfResult,
  SyntheticRdfUncheckedOptions,
} from "./types.js";
import { RDF, RDFS, SH } from "./vocab.js";

const TARGET_PREDICATES = new Set<string>([
  SH.target.value,
  SH.targetClass.value,
  SH.targetNode.value,
  SH.targetObjectsOf.value,
  SH.targetSubjectsOf.value,
]);

function addValidationFocus(validationShapes: Store, shape: Term, focus: Term): void {
  if (
    shape.termType === "Literal" ||
    shape.termType === "DefaultGraph" ||
    shape.termType === "Quad" ||
    focus.termType === "DefaultGraph" ||
    focus.termType === "Quad"
  ) {
    throw new Error(`Invalid SHACL validation target term ${focus.termType}`);
  }
  validationShapes.add(
    DataFactory.quad(shape as never, SH.targetNode, focus as never) as unknown as Quad,
  );
}

function focusTargetedShapes(
  result: SyntheticRdfResult,
  shapes: DatasetCore,
  validationData: DatasetCore,
): DatasetCore {
  const targets = [...shapes].filter((value) => TARGET_PREDICATES.has(value.predicate.value));
  const validationShapes = new Store(
    [...shapes].filter(
      (value) =>
        !TARGET_PREDICATES.has(value.predicate.value) || value.predicate.equals(SH.targetClass),
    ) as never,
  );
  for (const instance of result.instances) {
    addValidationFocus(validationShapes, instance.shape, instance.focus);
  }
  for (const target of targets) {
    if (target.predicate.equals(SH.target)) {
      throw new Error(`Unsupported custom SHACL target on ${target.subject.value}`);
    }
    if (target.predicate.equals(SH.targetNode)) {
      addValidationFocus(validationShapes, target.subject, target.object);
      continue;
    }
    if (target.predicate.equals(SH.targetClass)) {
      for (const value of validationData.match(null, RDF.type, target.object, null)) {
        addValidationFocus(validationShapes, target.subject, value.subject);
      }
      continue;
    }
    if (target.object.termType !== "NamedNode") {
      throw new Error(`SHACL predicate target on ${target.subject.value} must name a predicate`);
    }
    const matches = validationData.match(null, target.object, null, null);
    for (const value of matches) {
      addValidationFocus(
        validationShapes,
        target.subject,
        target.predicate.equals(SH.targetSubjectsOf) ? value.subject : value.object,
      );
    }
  }
  return validationShapes as unknown as DatasetCore;
}

function validationDataset(
  result: SyntheticRdfResult,
  ontology: DatasetCore | undefined,
): DatasetCore {
  if (ontology === undefined) return result.dataset;
  const dataset = new Store([...ontology, ...result.dataset] as never);
  for (const type of [...dataset.match(null, RDF.type, null, null)]) {
    if (type.object.termType !== "NamedNode") continue;
    const queue = [type.object];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current.value)) continue;
      visited.add(current.value);
      dataset.add(DataFactory.quad(type.subject as never, RDF.type, current as never));
      for (const relation of dataset.match(
        current as never,
        RDFS.subClassOf as never,
        null,
        null,
      )) {
        if (relation.object.termType === "NamedNode") queue.push(relation.object);
      }
    }
  }
  return dataset as unknown as DatasetCore;
}

export type {
  GeneratedInstance,
  GenerationContext,
  PropertyConstraints,
  ShaclValidator,
  ShapeOverride,
  SubStream,
  SyntheticRdfOptions,
  SyntheticRdfResult,
  SyntheticRdfUncheckedOptions,
  TargetSpec,
  TurtleOptions,
  ValueGenerator,
} from "./types.js";

/** Generate data and require an independent validator to confirm the merged result. */
export async function generate(options: SyntheticRdfOptions): Promise<SyntheticRdfResult> {
  if (options.validator === undefined || typeof options.validator.validate !== "function") {
    throw new Error(
      "generate() requires an injected ShaclValidator; use generateUnchecked() explicitly to skip validation",
    );
  }
  const result = generateCore(options);
  const validationData = validationDataset(result, options.ontology);
  const validation = await options.validator.validate(
    validationData,
    focusTargetedShapes(result, options.shapes, validationData),
  );
  if (!validation.conforms) {
    throw new Error(
      `Generated RDF does not conform to the supplied SHACL shapes:\n${validation.report}`,
    );
  }
  return result;
}

/** Generate without independent SHACL validation. Prefer {@link generate}. */
export function generateUnchecked(options: SyntheticRdfUncheckedOptions): SyntheticRdfResult {
  return generateCore(options);
}
