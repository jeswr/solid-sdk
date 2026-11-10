// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { ResourceReadError, ResourceWriteError } from "./errors";
import { isDirectChild } from "./layout";
import { readRdf, writeRdf } from "./rdf-io";
import { assertUpdateIdentities } from "./update-store";
import { DCT, NS, RDFS_LABEL } from "./vocab";

export interface DocumentVersion {
  url: string;
  snapshot: string;
  created: string;
  creator?: string | undefined;
  name?: string | undefined;
  kind: "named" | "automatic";
}
const KIND = `${NS.PD}versionKind`;
const SNAPSHOT = `${NS.PD}snapshot`;

/** Small typed RDF facade; malformed children are isolated by the listing boundary. */
class VersionMetadata extends TermWrapper {
  read(): Omit<DocumentVersion, "url"> {
    const created = OptionalFrom.subjectPredicate(this, DCT.created, LiteralAs.date);
    const snapshot = OptionalFrom.subjectPredicate(this, SNAPSHOT, NamedNodeAs.string);
    const kind = OptionalFrom.subjectPredicate(this, KIND, LiteralAs.string);
    if (
      !created ||
      !Number.isFinite(created.getTime()) ||
      !snapshot ||
      (kind !== "named" && kind !== "automatic")
    )
      throw new Error("Malformed document version");
    return {
      created: created.toISOString(),
      snapshot,
      kind,
      creator: OptionalFrom.subjectPredicate(this, DCT.creator, NamedNodeAs.string),
      name: OptionalFrom.subjectPredicate(this, RDFS_LABEL, LiteralAs.string),
    };
  }
  write(version: Omit<DocumentVersion, "url">) {
    OptionalAs.object(this, DCT.created, new Date(version.created), LiteralFrom.dateTime);
    OptionalAs.object(this, DCT.creator, version.creator, NamedNodeFrom.string);
    OptionalAs.object(this, RDFS_LABEL, version.name, LiteralFrom.string);
    OptionalAs.object(this, KIND, version.kind, LiteralFrom.string);
    OptionalAs.object(this, SNAPSHOT, version.snapshot, NamedNodeFrom.string);
  }
}

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
        const entry = new VersionMetadata(url, dataset, DataFactory).read();
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
    if (!response.ok) throw new ResourceWriteError(version.snapshot, response.status);
    const metadata = new Store();
    new VersionMetadata(version.url, metadata, DataFactory).write(version);
    await writeRdf(version.url, metadata, { fetchImpl: this.http, createOnly: true });
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
