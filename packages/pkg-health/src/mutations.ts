// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildNanopublications,
  createFactAssertion,
  type Fact,
  type Nanopublications,
  type NanopubStore,
  parseNanopublications,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { entities } from "./generated/model.js";
import { ReadNode } from "./read.js";
import { HealthGraphError } from "./types.js";

export interface HealthMutationOptions {
  clientId: string;
  batchId: string;
  generatedAt?: string;
}
/** Append a withdrawal via the store's owner-protected, immutable history path. */
export async function forgetHealthFact(
  store: NanopubStore,
  id: string,
  options: HealthMutationOptions,
): Promise<Nanopublications> {
  try {
    return await store.retract(id, options);
  } catch {
    throw new HealthGraphError("write-failed");
  }
}
/** Owner corrections support the three existing health templates; the original bytes remain. */
export async function correctHealthFact(
  store: NanopubStore,
  id: string,
  corrected: Fact,
  options: HealthMutationOptions,
): Promise<Nanopublications> {
  try {
    // Snapshot once; getters cannot switch to another template between validation and build.
    const fact: Fact = structuredClone(corrected);
    if (
      fact.template !== "condition" &&
      fact.template !== "allergy" &&
      fact.template !== "medication"
    )
      throw new HealthGraphError("unsupported-correction");
    const original = await store.get(id);
    const previous = original.nanopubs[0];
    if (!previous) throw new HealthGraphError("invalid-correction");
    const assertion = new Store([
      ...new NamedGraphDataset(df.namedNode(previous.assertionId), original.dataset, df),
    ]);
    const subjects = [...new Set([...assertion].map((q) => q.subject.value))];
    const models = [entities.Condition, entities.AllergyIntolerance, entities.MedicationStatement];
    const nodes = subjects
      .map((s) => new ReadNode(s, assertion))
      .filter((node) => models.some((m) => new m.Wrapper(node.term, assertion, df).isInstance));
    const owners = nodes.flatMap((n) => n.owners);
    const owner = owners[0];
    if (
      owner?.termType !== "NamedNode" ||
      owners.some((t) => !t.equals(owner)) ||
      owner.value !== store.ownerWebId
    )
      throw new HealthGraphError("invalid-correction");
    const now = options.generatedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(now)) || Date.parse(now) < Date.parse(previous.generatedAt))
      throw new HealthGraphError("invalid-correction");
    const built = await buildNanopublications(
      {
        batch_id: options.batchId,
        worker: { agent_id: options.clientId, agent_label: "Owner health correction" },
        sources: [
          { id: "original", kind: "document", url: store.url(id), title: "Owner correction" },
        ],
        claims: [
          // The builder resolves revision references within a batch. This anchor is never put.
          { id: "previous", assertion: new Store([...assertion]), epistemic: previous.epistemic },
          {
            id: "correction",
            assertion: createFactAssertion(owner.value, fact),
            epistemic: "SelfReportedExplicit",
            categories: previous.categories,
            attributed_to: owner.value,
            supersedes: ["previous"],
            evidence: [
              { source: "original", quote: "Correction supplied by the owner.", timestamp: now },
            ],
          },
        ],
      },
      { owner: owner.value, generatedAt: now },
    );
    const revision = built.nanopubs.find((np) => np.identifier === `${options.batchId}/correction`);
    if (!revision) throw new HealthGraphError("invalid-correction");
    // Rehashing an already-skolemized original can change its assertion ID. Retain the
    // exact original revision target, as NanopubStore.retract also does internally.
    const scoped = new NamedGraphDataset(df.namedNode(revision.provenanceId), built.dataset, df);
    const revisionNode = new TermWrapper(revision.assertionId, scoped, df);
    const links = SetFrom.subjectPredicate(
      revisionNode,
      "http://www.w3.org/ns/prov#wasRevisionOf",
      TermAs.term,
      TermFrom.itself,
    );
    links.clear();
    links.add(df.namedNode(previous.assertionId));
    const anchor = built.nanopubs.find((np) => np.identifier === `${options.batchId}/previous`);
    if (!anchor) throw new HealthGraphError("invalid-correction");
    const omitted = new Set([
      anchor.id,
      anchor.provenanceId,
      anchor.pubinfoId,
      ...(anchor.assertionId === revision.assertionId ? [] : [anchor.assertionId]),
    ]);
    const dataset = new Store([...built.dataset].filter((q) => !omitted.has(q.graph.value)));
    const result = await parseNanopublications(
      await serializeNanopublications({ dataset, nanopubs: [revision] }),
    );
    await store.put(result);
    return result;
  } catch (error) {
    if (error instanceof HealthGraphError) throw error;
    throw new HealthGraphError("write-failed");
  }
}
