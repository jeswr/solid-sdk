// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6

import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { canonicalizeJeswrDataset } from "./canonical-vocab.js";
import {
  IntegrationSyncError,
  PreconditionUnsupportedError,
  type PrivateDestinationError,
} from "./errors.js";
import { copyDataset, mergeItems } from "./incremental.js";
import { registrationsFor } from "./pod-writer.js";
import {
  isStrongEtag,
  requirePrivateDestination,
  requirePrivateWriteConfirmation,
  requiresPrivateDestination,
} from "./pod-writer-policy.js";
import { PROV, Provenance } from "./provenance.js";
import type {
  BinaryDoc,
  ConnectorRunCounts,
  ConnectorState,
  ConnectorStateOptions,
  ImportOutcome,
  MutationGuard,
  NormalisedDoc,
  PodWriter,
  TypeRegistrationRequest,
  VocabMap,
  WriteConditions,
  WrittenBinary,
  WrittenDoc,
} from "./types.js";
import { safeIri, VOCAB_PREFIXES } from "./vocab.js";

const RUNS = "_provenance.ttl";
/** Connector containers with a run in progress in this process. */
const active = new Set<string>();
/** Run provenance is a bounded summary; documents retain every item origin. */
export const MAX_RUN_SOURCES = 1_000;

export interface ImportSessionOptions extends ConnectorStateOptions {
  readonly signal?: AbortSignal;
  /** Lower the run provenance source ceiling; includes the connector source, minimum 1. */
  readonly maxRunSources?: number;
  /** Retain only this many run activities; polling adapters opt in. */
  readonly maxRunActivities?: number;
}

/** Shared write pipeline for API and file runners; host owns state persistence. */
export function createImportSession(
  writer: PodWriter,
  id: string,
  source: string,
  options: ImportSessionOptions,
  vocabMap?: VocabMap,
  attribution?: { readonly iri: string; readonly label: string },
) {
  if (
    options.maxRunActivities !== undefined &&
    (!Number.isSafeInteger(options.maxRunActivities) ||
      options.maxRunActivities < 1 ||
      options.maxRunActivities > 1000)
  )
    throw new RangeError("Run history limit must be between 1 and 1000.");
  if (attribution) {
    attribution = { iri: attribution.iri, label: attribution.label };
    const iri = safeIri(attribution.iri);
    if (!iri || !/^https:\/\/[^/?#]/i.test(iri))
      throw new IntegrationSyncError(id, "Demo agent must use an absolute HTTPS IRI.");
    const url = new URL(iri);
    if (url.username || url.password)
      throw new IntegrationSyncError(id, "Demo agent IRI must not contain credentials.");
    if (typeof attribution.label !== "string" || !attribution.label.trim())
      throw new IntegrationSyncError(id, "Demo agent must have a nonblank label.");
  }
  const requestedSources = options.maxRunSources ?? MAX_RUN_SOURCES;
  if (!Number.isSafeInteger(requestedSources) || requestedSources < 1)
    throw new RangeError("Run provenance source limit must be a positive safe integer.");
  const maxRunSources = Math.min(requestedSources, MAX_RUN_SOURCES);
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
  // Retain one counter per document, never identifiers for every imported subject.
  const itemCounts = new Map<string, number>();
  const privateImport = requiresPrivateDestination(id);
  let privacyRefused: Promise<PrivateDestinationError> | undefined;
  let afterWriteRefused: Promise<PrivateDestinationError> | undefined;
  const guardMutation: MutationGuard = () =>
    privacyRefused?.then((error) => {
      throw error;
    });
  const guards: [] | [MutationGuard] = privateImport ? [guardMutation] : [];
  const pendingWrites = new Set<Promise<unknown>>();
  function trackPrivateWrite<Args extends unknown[], Result>(
    operation: (...args: Args) => Promise<Result>,
  ) {
    if (!privateImport) return operation;
    return (...args: Args) => {
      const pending = operation(...args);
      pendingWrites.add(pending);
      const settled = () => pendingWrites.delete(pending);
      void pending.then(settled, settled);
      return pending;
    };
  }
  async function waitForPrivateWrites() {
    while (pendingWrites.size) await Promise.allSettled(pendingWrites);
    if (afterWriteRefused) throw await afterWriteRefused;
  }
  async function verifyDestination(url: string): Promise<void> {
    if (!privateImport) return;
    if (privacyRefused) throw await privacyRefused;
    try {
      await requirePrivateDestination(id, writer, url, guardMutation);
    } catch (error) {
      privacyRefused ??= Promise.resolve(error as PrivateDestinationError);
      throw await privacyRefused;
    }
  }
  async function confirmWrittenDestination(
    slug: string,
    url: string,
    created: boolean,
    etag?: string,
  ): Promise<void> {
    await requirePrivateWriteConfirmation(id, writer, slug, url, created, etag, (refusal) => {
      privacyRefused ??= refusal;
      afterWriteRefused ??= refusal;
    });
    options.signal?.throwIfAborted();
  }
  const changes = new Map<string, "created" | "updated" | "unchanged">();
  const changesCount = { created: 0, updated: 0, unchanged: 0 };
  const tracking = options.trackChanges === true || options.onRunCounts !== undefined;
  function counts(skipped = 0): ConnectorRunCounts {
    return { ...changesCount, skipped };
  }
  const contentOnly = (dataset: DatasetCore) => {
    const result = copyDataset();
    for (const quad of dataset) {
      if (
        quad.predicate.value !== `${PROV}wasGeneratedBy` &&
        quad.predicate.value !== `${PROV}wasDerivedFrom`
      )
        result.add(quad);
    }
    return result;
  };
  const conditionFor = (
    existing: Awaited<ReturnType<PodWriter["read"]>>,
  ): WriteConditions | undefined =>
    !existing ? { ifNoneMatch: "*" } : existing.etag ? { ifMatch: existing.etag } : undefined;
  /** Metadata-preserving canonical read; sync supplies explicit preconditions and need not cache. */
  async function readResource(
    slug: string,
    retainPrecondition = true,
    inspect?: (dataset: DatasetCore) => void,
  ) {
    const stored = await writer.read(slug);
    if (stored) inspect?.(stored.dataset);
    const existing = stored
      ? { ...stored, dataset: canonicalizeJeswrDataset(stored.dataset) }
      : undefined;
    if (retainPrecondition) reads.set(writer.resolve(slug), existing);
    return existing ? { ...existing, dataset: copyDataset(existing.dataset) } : undefined;
  }
  async function read(
    slug: string,
    inspect?: (dataset: DatasetCore) => void,
  ): Promise<DatasetCore | undefined> {
    return (await readResource(slug, true, inspect))?.dataset;
  }
  function releaseRead(slug: string): void {
    reads.delete(writer.resolve(slug));
  }
  async function write(input: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc> {
    const url = writer.resolve(input.slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    if (!reads.has(url)) await read(input.slug);
    const previous = reads.get(url);
    if (input.requirePrecondition && previous && !isStrongEtag(previous.etag))
      throw new PreconditionUnsupportedError(id, "Conditional write requires a strong ETag.");
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
    let itemCount = doc.writeMode === "merge" ? (itemCounts.get(url) ?? 0) : 0;
    const carried = new Set(input.carriedForward);
    for (const subject of subjects) {
      // Counts describe adapter-supplied local source items; mapped resources and subjects
      // kept from the stored document stay uncounted.
      if (
        subject === url ||
        !subject.startsWith(connectorRoot) ||
        !sourceSubjects.has(subject) ||
        carried.has(subject)
      )
        continue;
      // The stored dataset already records which subjects this run wrote. Inspect it
      // before incoming descriptions/provenance replace those subjects on a merge.
      if (
        doc.writeMode !== "merge" ||
        !previous ||
        !new Provenance(subject, previous.dataset, DataFactory).generatedBy.has(activityUrl)
      )
        itemCount++;
    }
    // Only adapter-supplied subjects replace existing descriptions; provenance adds the URL.
    const dataset = doc.writeMode === "merge" ? mergeItems(previous?.dataset, incoming) : incoming;
    const fallback = safeIri(input.sourceUrl) ?? source;
    const document = new Provenance(url, dataset, DataFactory);
    document.derivedFrom.add(fallback);
    document.generatedBy.clear();
    document.generatedBy.add(activityUrl);
    let marked = false;
    for (const subject of subjects) {
      // Linked identities keep their typing, but were not created by this import.
      if (!subject.startsWith(connectorRoot)) continue;
      const item = new Provenance(subject, dataset, DataFactory);
      const origin = item.sourceUrl ?? fallback;
      item.derivedFrom.add(origin);
      document.derivedFrom.add(origin);
      item.generatedBy.clear();
      item.generatedBy.add(activityUrl);
      if (attribution && subject !== url && !carried.has(subject)) {
        item.attributedTo.add(attribution.iri);
        marked = true;
      }
      if (used.size < maxRunSources) used.add(origin);
    }
    if (attribution && marked)
      new Provenance(attribution.iri, dataset, DataFactory).name = attribution.label;
    if (
      input.maxSerializedBytes !== undefined &&
      new TextEncoder().encode(await serialize([...dataset], { prefixes: { ...VOCAB_PREFIXES } }))
        .length > input.maxSerializedBytes
    ) {
      const error = new Error("Document exceeds its serialized byte cap.");
      error.name = "DocumentTooLargeError";
      throw error;
    }
    const before = tracking && previous ? contentOnly(previous.dataset) : undefined;
    const after = tracking ? contentOnly(dataset) : undefined;
    const unchanged =
      before && after && before.size === after.size && [...after].every((q) => before.has(q));
    const slug = doc.slug;
    const destination = privateImport ? writer.resolve(slug) : url;
    await verifyDestination(destination);
    const output = { ...doc, slug, dataset };
    const writeConditions = conditions ?? conditionFor(previous);
    if (privacyRefused) throw await privacyRefused;
    const { writeEtag, writeCreated, ...result } = await writer.write(
      output,
      writeConditions,
      ...guards,
    );
    if (privateImport)
      await confirmWrittenDestination(slug, destination, writeCreated === true, writeEtag);
    if (tracking) {
      const priorChange = changes.get(url);
      const change =
        priorChange === "created" || !previous
          ? "created"
          : unchanged && priorChange !== "updated"
            ? "unchanged"
            : "updated";
      if (priorChange) changesCount[priorChange]--;
      changes.set(url, change);
      changesCount[change]++;
      options.onRunCounts?.(counts());
    }
    // Take extra classes from the document, not the host writer's result: custom PodWriter
    // ports need not echo them.
    let registered: WrittenDoc = doc.additionalClasses?.length
      ? { ...result, additionalClasses: [...doc.additionalClasses] }
      : result;
    if (doc.registrationContainer !== undefined) {
      const container = writer.resolve(doc.registrationContainer);
      if (!container.endsWith("/") || !result.url.startsWith(container))
        throw new IntegrationSyncError(id, "Registration container must contain the document.");
      registered = { ...registered, registrationContainer: container };
    }
    for (const request of registrationsFor([registered])) {
      registrations.set(JSON.stringify([request.forClass, request.container]), request);
    }
    itemCounts.set(url, itemCount);
    reads.delete(url);
    const index = written.findIndex((w) => w.url === result.url);
    // Write validators are for the immediate caller. Reports remain stable across re-imports.
    const { etag: _writeEtag, ...reported } = registered;
    if (index === -1) written.push(reported);
    else written[index] = reported;
    writer.onWriteAccepted?.(result.url, output);
    return result;
  }
  /** Binary resources carry no RDF; their metadata documents link to them. */
  async function writeBinary(doc: BinaryDoc): Promise<WrittenBinary> {
    if (!writer.writeBinary)
      throw new IntegrationSyncError(id, "This host cannot store binary resources.");
    const slug = doc.slug;
    const url = writer.resolve(slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    await verifyDestination(url);
    if (privacyRefused) throw await privacyRefused;
    const { writeEtag, writeCreated, ...result } = await writer.writeBinary(
      { ...doc, slug },
      ...guards,
    );
    if (privateImport && result.created)
      await confirmWrittenDestination(slug, url, writeCreated === true, writeEtag);
    return result;
  }
  async function remove(slug: string): Promise<void> {
    if (!writer.remove) throw new IntegrationSyncError(id, "This host cannot delete resources.");
    const url = writer.resolve(slug);
    if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
      throw new Error("Reserved connector provenance slug.");
    const previous = reads.get(url);
    reads.delete(url);
    if (privacyRefused) throw await privacyRefused;
    await writer.remove(slug, previous?.etag ? { ifMatch: previous.etag } : undefined, ...guards);
    if (privateImport) options.signal?.throwIfAborted();
    itemCounts.delete(url);
    const priorChange = changes.get(url);
    if (priorChange) changesCount[priorChange]--;
    changes.delete(url);
    options.onRunCounts?.(counts());
    const index = written.findIndex((w) => w.url === url);
    if (index !== -1) written.splice(index, 1);
  }
  /**
   * Guarded raw ports for framework-owned documents that must not be remapped or stamped with
   * import provenance (two-way sync's mapped items, link shards and manifest, snapshots). They
   * apply exactly the private-destination contract of `write`/`remove`: verification before
   * the mutation (with the session's mutation guard), confirmation and clean-up after it, the
   * shared sticky refusal and pending-write tracking. They skip vocabulary mapping, provenance,
   * Type Index registration and written-document accounting. Non-private imports pass through.
   */
  const raw = {
    write: trackPrivateWrite(
      async (doc: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc> => {
        const url = writer.resolve(doc.slug);
        if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
          throw new Error("Reserved connector provenance slug.");
        reads.delete(url);
        await verifyDestination(url);
        if (privacyRefused) throw await privacyRefused;
        const { writeEtag, writeCreated, ...result } = await writer.write(
          doc,
          conditions,
          ...guards,
        );
        if (privateImport)
          await confirmWrittenDestination(doc.slug, url, writeCreated === true, writeEtag);
        return result;
      },
    ),
    remove: trackPrivateWrite(
      async (slug: string, conditions?: { readonly ifMatch?: string }): Promise<void> => {
        if (!writer.remove)
          throw new IntegrationSyncError(id, "This host cannot delete resources.");
        const url = writer.resolve(slug);
        if (url.split(/[?#]/, 1)[0] === writer.resolve(RUNS))
          throw new Error("Reserved connector provenance slug.");
        reads.delete(url);
        // As `remove`: a delete exposes nothing, so it needs no destination check, but it is a
        // mutation and never runs after a refusal.
        if (privacyRefused) throw await privacyRefused;
        await writer.remove(slug, conditions, ...guards);
        if (privateImport) options.signal?.throwIfAborted();
      },
    ),
    /**
     * Gate a host mutation the session cannot confirm itself (an owner-only ACL install for the
     * resource at `url`): verify the destination first and never run after a refusal.
     */
    async beforeMutation(url: string): Promise<void> {
      await verifyDestination(url);
      if (privacyRefused) throw await privacyRefused;
    },
  };
  let finalized = false;
  /** Records the run, then runs `committed` while this run still holds the connector. */
  async function finish(committed?: () => Promise<void>) {
    if (finalized) return;
    finalized = true;
    try {
      if (privacyRefused) throw await privacyRefused;
      await recordRun();
      await committed?.();
      await waitForPrivateWrites();
    } finally {
      active.delete(claim);
    }
  }
  /** End a cancelled run without further Pod I/O, freeing the connector for the next run. */
  function release() {
    if (finalized) return;
    finalized = true;
    active.delete(claim);
  }
  async function recordRun() {
    const previous = await writer.read(RUNS);
    if (options.maxRunActivities !== undefined && previous && !isStrongEtag(previous.etag))
      throw new PreconditionUnsupportedError(id, "Conditional run history requires a strong ETag.");
    const dataset = canonicalizeJeswrDataset(previous?.dataset);
    const activity = new Provenance(activityUrl, dataset, DataFactory);
    activity.types.add(`${PROV}Activity`);
    activity.associatedWith = connector;
    activity.startedAt = started;
    activity.endedAt = new Date();
    for (const url of used) activity.used.add(url);
    if (options.maxRunActivities !== undefined) {
      const previousActivities = dataset
        .getSubjects(`${PROV}wasAssociatedWith`, connector, null)
        .filter((subject) => {
          const prefix = `${writer.resolve(RUNS)}#run-`;
          if (
            subject.termType !== "NamedNode" ||
            subject.value === activityUrl ||
            !subject.value.startsWith(prefix)
          )
            return false;
          if (
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
              subject.value.slice(prefix.length),
            )
          )
            return false;
          try {
            return new Provenance(subject, dataset, DataFactory).types.has(`${PROV}Activity`);
          } catch {
            return false;
          }
        })
        .map((subject) => {
          let time = 0;
          try {
            const ended = new Provenance(subject, dataset, DataFactory).endedAt?.getTime();
            if (ended !== undefined && Number.isFinite(ended)) time = ended;
          } catch {
            /* A malformed old timestamp sorts before complete summaries. */
          }
          return { subject, time };
        })
        .sort((a, b) => b.time - a.time);
      for (const { subject } of previousActivities.slice(options.maxRunActivities - 1))
        dataset.removeQuads(dataset.getQuads(subject, null, null, null));
    }
    const url = writer.resolve(RUNS);
    await verifyDestination(url);
    if (privacyRefused) throw await privacyRefused;
    const result = await writer.write(
      {
        slug: RUNS,
        category: "provenance",
        forClass: `${PROV}Activity`,
        dataset,
        skipRegistration: true,
      },
      conditionFor(previous),
      ...guards,
    );
    if (privateImport)
      await confirmWrittenDestination(RUNS, url, result.writeCreated === true, result.writeEtag);
  }
  function state(outcome?: ImportOutcome): ConnectorState {
    const success = outcome !== undefined;
    return {
      ...options.state,
      connectedAt: options.state?.connectedAt ?? started.toISOString(),
      lastSync: success ? new Date().toISOString() : options.state?.lastSync,
      cursor: success ? (outcome.cursor ?? options.state?.cursor) : options.state?.cursor,
      lastOutcome: success ? "success" : "error",
      counts: success
        ? {
            documents: written.length,
            items: [...itemCounts.values()].reduce((total, count) => total + count, 0),
            skipped: outcome.skipped ?? 0,
          }
        : (options.state?.counts ?? { documents: 0, items: 0, skipped: 0 }),
    };
  }
  return {
    read,
    readResource,
    releaseRead,
    write: trackPrivateWrite(write),
    writeBinary: trackPrivateWrite(writeBinary),
    remove,
    written,
    counts,
    tracking,
    /** Document-level accounting, exposed read-only for diagnostics. */
    itemCounts: itemCounts as ReadonlyMap<string, number>,
    /** Bounded run provenance summary, exposed read-only for diagnostics. */
    used: used as ReadonlySet<string>,
    async registerTypes() {
      if (privacyRefused) throw await privacyRefused;
      return writer.registerType([...registrations.values()], ...guards);
    },
    raw,
    waitForPrivateWrites,
    finish,
    release,
    state,
  };
}
