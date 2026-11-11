// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { isDirectChild } from "@jeswr/solid-docs/layout";
import { NS } from "@jeswr/solid-docs/vocab";
import type { DatasetCore } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { ResourceReadError, ResourceWriteError } from "./errors";
import { readRdf, writeRdf } from "./rdf-io";
import { assertUpdateIdentities } from "./update-store";

export type { DocumentVersion } from "@jeswr/solid-docs/versions";

import { buildVersion, type DocumentVersion, readVersion } from "@jeswr/solid-docs/versions";

/** Immutable full-state snapshots, independent of the compactable collaborative log. */
export class DocumentVersionStore {
  constructor(
    readonly container: string,
    private readonly http: typeof fetch,
  ) {}

  async list(): Promise<DocumentVersion[]> {
    let dataset: DatasetCore;
    try {
      ({ dataset } = await readRdf(this.container, this.http));
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return [];
      throw error;
    }
    const anchor = new TermWrapper(this.container, dataset, DataFactory);
    const children = [
      ...SetFrom.subjectPredicate(anchor, `${NS.LDP}contains`, TermAs.term, TermFrom.itself),
    ]
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value);
    const present = new Set(children);
    const versions: DocumentVersion[] = [];
    for (const url of children) {
      if (!isDirectChild(url, this.container) || !url.endsWith(".ttl")) continue;
      try {
        const { dataset } = await readRdf(url, this.http);
        const entry = readVersion(url, dataset);
        if (
          !isDirectChild(entry.snapshot, this.container) ||
          !entry.snapshot.endsWith(".bin") ||
          !present.has(entry.snapshot)
        )
          continue;
        versions.push({ url, ...entry });
      } catch {
        // One orphan, inaccessible or malformed metadata resource cannot hide the rest.
      }
    }
    return versions.sort(
      (a, b) => b.created.localeCompare(a.created) || b.url.localeCompare(a.url),
    );
  }

  async create(
    doc: Doc,
    options: { kind: DocumentVersion["kind"]; name?: string; creator?: string; now?: Date },
  ): Promise<DocumentVersion> {
    const created = (options.now ?? new Date()).toISOString();
    const id = `${created.replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
    return this.write(
      {
        url: `${this.container}${id}.ttl`,
        snapshot: `${this.container}${id}.bin`,
        created,
        kind: options.kind,
        creator: options.creator,
        name: options.name,
      },
      encodeStateAsUpdate(doc),
    );
  }

  /** Also used when copying history; snapshots are always published before metadata. */
  async write(version: DocumentVersion, bytes: Uint8Array): Promise<DocumentVersion> {
    if (
      !isDirectChild(version.url, this.container) ||
      !isDirectChild(version.snapshot, this.container)
    )
      throw new Error("Invalid version location");
    // Old documents may not yet have a versions container.
    const dataset = new Store();
    new Container(this.container, dataset, DataFactory).type.add(`${NS.LDP}BasicContainer`);
    try {
      await writeRdf(this.container, dataset, { fetchImpl: this.http, createOnly: true });
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412)) throw error;
    }
    const response = await this.http(version.snapshot, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "application/octet-stream", "if-none-match": "*" },
      body: new Uint8Array(bytes),
    });
    // 412: a retried copy already published this snapshot under the same name.
    if (!response.ok && response.status !== 412)
      throw new ResourceWriteError(version.snapshot, response.status);
    const metadata = buildVersion(version);
    try {
      await writeRdf(version.url, metadata, { fetchImpl: this.http, createOnly: true });
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412)) throw error;
    }
    return version;
  }

  async load(version: DocumentVersion, instanceId: string): Promise<Doc> {
    if (!isDirectChild(version.snapshot, this.container) || !version.snapshot.endsWith(".bin"))
      throw new Error("Invalid version location");
    const response = await this.http(version.snapshot, { redirect: "error" });
    if (!response.ok) throw new ResourceReadError(version.snapshot, response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertUpdateIdentities([bytes], instanceId);
    const doc = new Doc();
    applyUpdate(doc, bytes);
    // assertUpdateIdentities admits identity-less legacy deltas; a version
    // snapshot is a whole state, so it must carry this document's identity.
    if (doc.getMap("document").get("instanceId") !== instanceId) {
      doc.destroy();
      throw new Error("This version belongs to a different document");
    }
    return doc;
  }
}

export function versionError(error: unknown): string {
  if (error instanceof Error && "status" in error && (error.status === 401 || error.status === 403))
    return "You don't have permission to access this document's version history.";
  return error instanceof Error
    ? error.message
    : "Couldn't load version history. Try again when connected.";
}
