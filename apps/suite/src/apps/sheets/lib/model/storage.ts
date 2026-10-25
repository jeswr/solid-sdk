// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import { DatasetWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { type Column, csvToGrid, type Grid, gridToCsv } from "./grid";
import {
  httpIri,
  parseDescriptor,
  parseWorkbook,
  SCHEMA,
  type SheetDescriptor,
  SheetResource,
  SOLID,
  SPREADSHEET_CLASS,
  serializeDescriptor,
  serializeWorkbook,
  type WorkbookMetadata,
  workbookLayout,
} from "./rdf";
import { deserializeSnapshot, type Snapshot, serializeSnapshot } from "./snapshot";

class TypeIndexDataset extends DatasetWrapper {
  get registrations() {
    return this.instancesOf(`${SOLID}TypeRegistration`, SheetResource);
  }
}

export type Precondition =
  | { ifMatch: string; ifNoneMatch?: never }
  | { ifNoneMatch: "*"; ifMatch?: never };
export interface Stored<T> {
  value: T;
  etag: string | null;
}

export class SheetStorageError extends Error {
  constructor(
    public readonly status: number,
    public readonly etag: string | null,
  ) {
    super(`Spreadsheet resource request failed (${status})`);
    this.name = "SheetStorageError";
  }
}

function preconditionHeaders(condition: Precondition): Record<string, string> {
  if (condition.ifNoneMatch === "*" && condition.ifMatch === undefined)
    return { "If-None-Match": "*" };
  if (
    condition.ifNoneMatch === undefined &&
    typeof condition.ifMatch === "string" &&
    /^"[^"\r\n]*"$/.test(condition.ifMatch)
  ) {
    return { "If-Match": condition.ifMatch };
  }
  throw new TypeError("A create-only or strong ETag precondition is required");
}

/**
 * Resource-level I/O only. The later hook owns save scheduling, container creation,
 * multi-resource partial-save recovery, Type Index discovery and conflict resolution.
 */
export function createSheetStorage(fetch: typeof globalThis.fetch, podRoot: string) {
  const scopedFetch = createPodScopedFetch(httpIri(podRoot), { fetch: refuseRedirects(fetch) });
  async function read(url: string, accept: string): Promise<Stored<string>> {
    const response = await scopedFetch(url, { headers: { Accept: accept }, cache: "no-store" });
    if (!response.ok) throw new SheetStorageError(response.status, response.headers.get("etag"));
    return { value: await response.text(), etag: response.headers.get("etag") };
  }
  async function write(
    url: string,
    body: string,
    contentType: string,
    condition: Precondition,
  ): Promise<string | null> {
    const headers = { "Content-Type": contentType, ...preconditionHeaders(condition) };
    const response = await scopedFetch(url, { method: "PUT", headers, body });
    if (!response.ok) throw new SheetStorageError(response.status, response.headers.get("etag"));
    return response.headers.get("etag");
  }
  return {
    async loadIndex(container: string): Promise<Stored<WorkbookMetadata>> {
      const result = await read(workbookLayout(container).index, "text/turtle");
      return { ...result, value: await parseWorkbook(container, result.value) };
    },
    async saveIndex(container: string, metadata: WorkbookMetadata, condition: Precondition) {
      return write(
        workbookLayout(container).index,
        await serializeWorkbook(container, metadata),
        "text/turtle",
        condition,
      );
    },
    async loadCsv(container: string, number: number, columns?: Column[]): Promise<Stored<Grid>> {
      const result = await read(workbookLayout(container).sheet(number).csv, "text/csv");
      return { ...result, value: csvToGrid(result.value, columns) };
    },
    async saveCsv(container: string, number: number, grid: Grid, condition: Precondition) {
      return write(
        workbookLayout(container).sheet(number).csv,
        gridToCsv(grid),
        "text/csv",
        condition,
      );
    },
    async loadDescriptor(container: string, number: number): Promise<Stored<SheetDescriptor>> {
      const result = await read(
        workbookLayout(container).sheet(number).descriptor,
        "application/ld+json",
      );
      return { ...result, value: await parseDescriptor(container, number, result.value) };
    },
    async saveDescriptor(
      container: string,
      number: number,
      descriptor: SheetDescriptor,
      condition: Precondition,
    ) {
      return write(
        workbookLayout(container).sheet(number).descriptor,
        await serializeDescriptor(container, number, descriptor),
        "application/ld+json",
        condition,
      );
    },
    async loadSnapshot(container: string): Promise<Stored<Snapshot>> {
      const result = await read(workbookLayout(container).snapshot, "application/json");
      return { ...result, value: deserializeSnapshot(result.value) };
    },
    async saveSnapshot(container: string, snapshot: Snapshot, condition: Precondition) {
      return write(
        workbookLayout(container).snapshot,
        serializeSnapshot(snapshot),
        "application/json",
        condition,
      );
    },
    /** Register the workbook's RDF subject in an existing caller-selected index (PM pattern). */
    async registerSpreadsheet(
      indexUrl: string,
      container: string,
    ): Promise<{ added: boolean; etag: string | null }> {
      const index = httpIri(indexUrl);
      if (new URL(index).hash) throw new TypeError("Type Index URL must identify a document");
      const subject = workbookLayout(container).subject;
      // Scope-check the workbook even though this operation only fetches the index.
      const root = workbookLayout(container).container;
      // Validate through the shared pod guard without making a request.
      assertWithinPodScope(podRoot, root);
      const result = await read(index, "text/turtle");
      const dataset = await parseRdf(result.value, "text/turtle", { baseIRI: index });
      const wrappers = new TypeIndexDataset(dataset, DataFactory);
      for (const registration of wrappers.registrations) {
        if (
          registration.iri(`${SOLID}forClass`) === SPREADSHEET_CLASS &&
          registration.iri(`${SOLID}instance`) === subject &&
          registration.iri(`${SOLID}instanceContainer`) === undefined
        ) {
          return { added: false, etag: result.etag };
        }
      }
      if (result.etag === null) throw new TypeError("Type Index has no strong ETag");
      const registration = new SheetResource(
        `${index}#sheets-${encodeURIComponent(subject)}`,
        dataset,
        DataFactory,
      );
      registration.types.add(`${SOLID}TypeRegistration`);
      registration.setIri(`${SOLID}forClass`, SPREADSHEET_CLASS);
      registration.setIri(`${SOLID}instance`, subject);
      const etag = await write(
        index,
        await serialize([...dataset], { prefixes: { solid: SOLID, schema: SCHEMA } }),
        "text/turtle",
        { ifMatch: result.etag },
      );
      return { added: true, etag };
    },
  };
}
