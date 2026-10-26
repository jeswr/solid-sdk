// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { IntegrationSyncError } from "./errors.js";
import { copyDataset, mergeItems } from "./incremental.js";
import { registrationsFor } from "./pod-writer.js";
import { PROV, Provenance } from "./provenance.js";
import type {
  BinaryDoc,
  ConnectorState,
  ConnectorStateOptions,
  ImportOutcome,
  NormalisedDoc,
  PodWriter,
  TypeRegistrationRequest,
  VocabMap,
  WriteConditions,
  WrittenBinary,
  WrittenDoc,
} from "./types.js";
import { safeIri } from "./vocab.js";

const RUNS = "_provenance.ttl";
/** Shared write pipeline for API and file runners; host owns state persistence. */
export function createImportSession(
  writer: PodWriter,
  id: string,
  source: string,
  options: ConnectorStateOptions,
  vocabMap?: VocabMap,
) {
  const started = new Date();
  const activityUrl = `${writer.resolve(RUNS)}#run-${crypto.randomUUID()}`;
  const connector = `urn:solid:connector:${encodeURIComponent(id)}`;
  const reads = new Map<string, Awaited<ReturnType<PodWriter["read"]>>>();
  const used = new Set<string>([source]);
  const written: WrittenDoc[] = [];
  const registrations = new Map<string, TypeRegistrationRequest>();
  const itemKeys = new Set<string>();
  const conditionFor = (
    existing: Awaited<ReturnType<PodWriter["read"]>>,
  ): WriteConditions | undefined =>
    !existing ? { ifNoneMatch: "*" } : existing.etag ? { ifMatch: existing.etag } : undefined;
  async function read(slug: string): Promise<DatasetCore | undefined> {
    const existing = await writer.read(slug);
    reads.set(writer.resolve(slug), existing);
    return existing ? copyDataset(existing.dataset) : undefined;
  }
  async function write(input: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc> {
    const url = writer.resolve(input.slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    if (!reads.has(url)) await read(input.slug);
    const previous = reads.get(url);
    const doc = vocabMap ? vocabMap({ ...input, dataset: copyDataset(input.dataset) }) : input;
    const incoming = copyDataset(doc.dataset);
    const subjects = new Set(
      [...incoming].filter((q) => q.subject.termType === "NamedNode").map((q) => q.subject.value),
    );
    // Only adapter-supplied subjects replace existing descriptions; provenance adds the URL.
    const dataset = doc.writeMode === "merge" ? mergeItems(previous?.dataset, incoming) : incoming;
    const fallback = safeIri(input.sourceUrl) ?? source;
    const document = new Provenance(url, dataset, DataFactory);
    document.derivedFrom.add(fallback);
    document.generatedBy.clear();
    document.generatedBy.add(activityUrl);
    for (const subject of subjects) {
      const item = new Provenance(subject, dataset, DataFactory);
      const origin = item.sourceUrl ?? fallback;
      item.derivedFrom.add(origin);
      document.derivedFrom.add(origin);
      item.generatedBy.clear();
      item.generatedBy.add(activityUrl);
      used.add(origin);
      if (subject !== url) itemKeys.add(JSON.stringify([url, subject]));
    }
    const result = await writer.write({ ...doc, dataset }, conditions ?? conditionFor(previous));
    let registered = result;
    if (doc.registrationContainer !== undefined) {
      const container = writer.resolve(doc.registrationContainer);
      if (!container.endsWith("/") || !result.url.startsWith(container))
        throw new IntegrationSyncError(id, "Registration container must contain the document.");
      registered = { ...result, registrationContainer: container };
    }
    for (const request of registrationsFor([registered])) {
      registrations.set(JSON.stringify([request.forClass, request.container]), request);
    }
    reads.delete(url);
    const index = written.findIndex((w) => w.url === result.url);
    if (index === -1) written.push(registered);
    else written[index] = registered;
    return result;
  }
  /** Binary resources carry no RDF; their metadata documents link to them. */
  async function writeBinary(doc: BinaryDoc): Promise<WrittenBinary> {
    if (!writer.writeBinary)
      throw new IntegrationSyncError(id, "This host cannot store binary resources.");
    const url = writer.resolve(doc.slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    return writer.writeBinary(doc);
  }
  async function remove(slug: string): Promise<void> {
    if (!writer.remove) throw new IntegrationSyncError(id, "This host cannot delete resources.");
    const url = writer.resolve(slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    const previous = reads.get(url);
    reads.delete(url);
    await writer.remove(slug, previous?.etag ? { ifMatch: previous.etag } : undefined);
    const index = written.findIndex((w) => w.url === url);
    if (index !== -1) written.splice(index, 1);
  }
  let finalized = false;
  async function finish() {
    if (finalized) return;
    finalized = true;
    const previous = await writer.read(RUNS);
    const dataset = copyDataset(previous?.dataset);
    const activity = new Provenance(activityUrl, dataset, DataFactory);
    activity.types.add(`${PROV}Activity`);
    activity.associatedWith = connector;
    activity.startedAt = started;
    activity.endedAt = new Date();
    for (const url of used) activity.used.add(url);
    await writer.write(
      {
        slug: RUNS,
        category: "provenance",
        forClass: `${PROV}Activity`,
        dataset,
        skipRegistration: true,
      },
      conditionFor(previous),
    );
  }
  function state(outcome?: ImportOutcome): ConnectorState {
    const success = outcome !== undefined;
    return {
      connectedAt: options.state?.connectedAt ?? started.toISOString(),
      lastSync: success ? new Date().toISOString() : options.state?.lastSync,
      cursor: success ? (outcome.cursor ?? options.state?.cursor) : options.state?.cursor,
      lastOutcome: success ? "success" : "error",
      counts: success
        ? { documents: written.length, items: itemKeys.size, skipped: outcome.skipped ?? 0 }
        : (options.state?.counts ?? { documents: 0, items: 0, skipped: 0 }),
    };
  }
  return {
    read,
    write,
    writeBinary,
    remove,
    written,
    registrations: () => [...registrations.values()],
    finish,
    state,
  };
}
