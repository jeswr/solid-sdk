// AUTHORED-BY Codex GPT-6
/** Verified carriage content. Only the wire reader installs these graph associations. */
import type { Term } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { AWP } from "../profile/vocabulary.js";

export interface AttachmentValue {
  readonly graph?: Store;
  readonly term?: Term;
}
const admitted = new WeakMap<Store, ReadonlyMap<string, AttachmentValue>>();
export function bindAttachments(
  dataset: Store,
  values: ReadonlyMap<string, AttachmentValue>,
): void {
  admitted.set(dataset, values);
}
export function attachmentGraph(dataset: Store, id: string): Store | undefined {
  return admitted.get(dataset)?.get(id)?.graph;
}
export function attachmentTerm(dataset: Store, term: Term): Term {
  return admitted.get(dataset)?.get(term.value)?.term ?? term;
}
/** Exact expanded projection, used to compare retained issuer bytes with their claims. */
export function materializeAttachments(dataset: Store): Store {
  const values = admitted.get(dataset);
  if (!values?.size) return dataset;
  const result = new Store();
  for (const quad of dataset) {
    if (values.has(quad.subject.value)) continue;
    const value = values.get(quad.object.value);
    result.addQuad(
      DataFactory.quad(
        quad.subject,
        quad.predicate,
        (value?.term ?? quad.object) as never,
        quad.graph,
      ),
    );
  }
  for (const value of values.values()) if (value.graph) result.addQuads([...value.graph]);
  return result;
}
export const ATTACHMENT = AWP + "Attachment";

export function cloneAttachmentDataset(dataset: Store): Store {
  const clone = new Store([...dataset]);
  const values = admitted.get(dataset);
  if (values)
    bindAttachments(
      clone,
      new Map(
        [...values].map(([id, value]) => [
          id,
          { ...value, ...(value.graph ? { graph: new Store([...value.graph]) } : {}) },
        ]),
      ),
    );
  return clone;
}
