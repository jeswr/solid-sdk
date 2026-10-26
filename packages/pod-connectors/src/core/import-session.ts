// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { canonicalizeJeswrDataset } from "./canonical-vocab.js";
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
/** Connector containers with a run in progress in this process. */
const active = new Set<string>();
/** Shared write pipeline for API and file runners; host owns state persistence. */
export function createImportSession(
  writer: PodWriter,
  id: string,
  source: string,
  options: ConnectorStateOptions,
  vocabMap?: VocabMap,
) {
  // One run per connector container at a time: imports reconcile against their own reads
  // (source inventories, collection documents), which an overlapping run would invalidate.
  const claim = writer.resolve(RUNS);
  if (active.has(claim))
    throw new IntegrationSyncError(id, "An import for this connector is already running.");
  active.add(claim);
  const started = new Date();
  const activityUrl = `${writer.resolve(RUNS)}#run-${crypto.randomUUID()}`;
  const connectorRoot = new URL(".", writer.resolve(RUNS)).href;
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
    const stored = await writer.read(slug);
    const existing = stored
      ? { ...stored, dataset: canonicalizeJeswrDataset(stored.dataset) }
      : undefined;
    reads.set(writer.resolve(slug), existing);
    return existing ? copyDataset(existing.dataset) : undefined;
  }
  async function write(input: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc> {
    const url = writer.resolve(input.slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    if (!reads.has(url)) await read(input.slug);
    const previous = reads.get(url);
    const sourceSubjects = new Set(
      [...input.dataset]
        .filter((q) => q.subject.termType === "NamedNode")
        .map((q) => q.subject.value),
    );
    const doc = vocabMap
      ? vocabMap({ ...input, dataset: copyDataset(input.dataset) }, { webId: writer.webId })
      : input;
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
      // Linked identities keep their typing, but were not created by this import.
      if (!subject.startsWith(connectorRoot)) continue;
      const item = new Provenance(subject, dataset, DataFactory);
      const origin = item.sourceUrl ?? fallback;
      item.derivedFrom.add(origin);
      document.derivedFrom.add(origin);
      item.generatedBy.clear();
      item.generatedBy.add(activityUrl);
      used.add(origin);
      // Sector maps can add linked people/activities. Counts describe the
      // adapter's local source items; local mapped resources also get provenance.
      if (subject !== url && sourceSubjects.has(subject))
        itemKeys.add(JSON.stringify([url, subject]));
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
    try {
      await recordRun();
    } finally {
      active.delete(claim);
    }
  }
  async function recordRun() {
    const previous = await writer.read(RUNS);
    const dataset = canonicalizeJeswrDataset(previous?.dataset);
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
