// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { JsonLdSerializer } from "jsonld-streaming-serializer";
import { DataFactory, Store } from "n3";
import type { Column, ColumnType, Grid } from "./grid";
import { inferColumns, validateColumns } from "./grid";

export const SCHEMA = "https://schema.org/";
export const DCT = "http://purl.org/dc/terms/";
export const SOLID = "http://www.w3.org/ns/solid/terms#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const SPREADSHEET_CLASS = `${SCHEMA}SpreadsheetDigitalDocument`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Shared typed accessors, following PM's DataCollection / TypeRegistration patterns. */
export class SheetResource extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  text(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(
      this,
      predicate,
      (term) => LiteralAs.datatypeTuple(term)[1],
    );
  }
  setText(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  iri(predicate: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  setIri(predicate: string, value: string): void {
    OptionalAs.object(this, predicate, httpIri(value), NamedNodeFrom.string);
  }
  links(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get position(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}position`, LiteralAs.number);
  }
  set position(value: number) {
    OptionalAs.object(this, `${SCHEMA}position`, value, LiteralFrom.integer);
  }
  get date(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}modified`, LiteralAs.date);
  }
  set date(value: Date) {
    OptionalAs.object(this, `${DCT}modified`, value, LiteralFrom.dateTime);
  }
}

export function httpIri(value: string): string {
  const iri = safeHttpIri(value);
  if (!iri || new URL(iri).username || new URL(iri).password)
    throw new TypeError("Invalid resource IRI");
  return iri;
}

export function workbookLayout(container: string) {
  const root = new URL(httpIri(container));
  if (!root.pathname.endsWith("/") || root.search || root.hash) {
    throw new TypeError("Workbook must be a container URL without query or fragment");
  }
  const index = new URL("index.ttl", root).href;
  return {
    container: root.href,
    index,
    subject: `${index}#it`,
    snapshot: new URL("workbook.json", root).href,
    sheet(number: number) {
      if (!Number.isSafeInteger(number) || number < 1) throw new TypeError("Invalid sheet number");
      return {
        csv: new URL(`sheets/${number}.csv`, root).href,
        descriptor: new URL(`sheets/${number}.jsonld`, root).href,
      };
    },
  };
}

export interface WorkbookMetadata {
  title: string;
  created: Date;
  modified: Date;
  creator: string;
  sheets: { number: number; name: string }[];
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Missing spreadsheet metadata");
  return value;
}
function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError("Invalid metadata date");
  return value;
}

export function workbookDataset(container: string, metadata: WorkbookMetadata): Store {
  const layout = workbookLayout(container);
  const dataset = new Store();
  const workbook = new SheetResource(layout.subject, dataset, DataFactory);
  workbook.types.add(SPREADSHEET_CLASS);
  workbook.types.add(`${SCHEMA}Dataset`);
  workbook.setText(`${DCT}title`, metadata.title);
  OptionalAs.object(workbook, `${DCT}created`, validDate(metadata.created), LiteralFrom.dateTime);
  workbook.date = validDate(metadata.modified);
  workbook.setIri(`${DCT}creator`, metadata.creator);
  workbook.setIri(`${SCHEMA}encoding`, layout.snapshot);
  const seen = new Set<number>();
  for (const sheet of metadata.sheets) {
    const urls = layout.sheet(sheet.number);
    if (seen.has(sheet.number)) throw new TypeError("Duplicate sheet number");
    seen.add(sheet.number);
    workbook.links(`${SCHEMA}hasPart`).add(urls.csv);
    const download = new SheetResource(urls.csv, dataset, DataFactory);
    download.types.add(`${SCHEMA}DataDownload`);
    download.setText(`${SCHEMA}name`, sheet.name);
    download.setText(`${SCHEMA}encodingFormat`, "text/csv");
    download.setIri(`${SCHEMA}contentUrl`, urls.csv);
    download.setIri(`${SCHEMA}subjectOf`, urls.descriptor);
    download.position = sheet.number;
  }
  return dataset;
}

export function readWorkbookDataset(container: string, dataset: DatasetCore): WorkbookMetadata {
  const layout = workbookLayout(container);
  const workbook = new SheetResource(layout.subject, dataset, DataFactory);
  if (!workbook.types.has(SPREADSHEET_CLASS) || !workbook.types.has(`${SCHEMA}Dataset`)) {
    throw new TypeError("Resource is not a spreadsheet dataset");
  }
  const metadata: WorkbookMetadata = {
    title: required(workbook.text(`${DCT}title`)),
    created: validDate(
      required(OptionalFrom.subjectPredicate(workbook, `${DCT}created`, LiteralAs.date)),
    ),
    modified: validDate(required(workbook.date)),
    creator: httpIri(required(workbook.iri(`${DCT}creator`))),
    sheets: [...workbook.links(`${SCHEMA}hasPart`)]
      .map((url) => {
        const download = new SheetResource(url, dataset, DataFactory);
        const number = required(download.position);
        const urls = layout.sheet(number);
        if (
          url !== urls.csv ||
          !download.types.has(`${SCHEMA}DataDownload`) ||
          download.text(`${SCHEMA}encodingFormat`) !== "text/csv" ||
          download.iri(`${SCHEMA}contentUrl`) !== urls.csv ||
          download.iri(`${SCHEMA}subjectOf`) !== urls.descriptor
        ) {
          throw new TypeError("Invalid sheet download");
        }
        return { number, name: required(download.text(`${SCHEMA}name`)) };
      })
      .sort((a, b) => a.number - b.number),
  };
  // Reuse write validation, including duplicate positions.
  workbookDataset(container, metadata);
  return metadata;
}

export async function serializeWorkbook(
  container: string,
  metadata: WorkbookMetadata,
): Promise<string> {
  return serialize([...workbookDataset(container, metadata)], {
    prefixes: { schema: SCHEMA, dct: DCT },
  });
}
export async function parseWorkbook(container: string, turtle: string): Promise<WorkbookMetadata> {
  return readWorkbookDataset(
    container,
    await parseRdf(turtle, "text/turtle", { baseIRI: workbookLayout(container).index }),
  );
}

const DATATYPES: Record<ColumnType, string> = {
  text: `${XSD}string`,
  number: `${XSD}double`,
  date: `${XSD}dateTime`,
};
export interface SheetDescriptor {
  name: string;
  columns: Column[];
}
export function descriptorDataset(
  container: string,
  number: number,
  descriptor: SheetDescriptor,
): Store {
  const urls = workbookLayout(container).sheet(number);
  validateColumns(descriptor.columns);
  const dataset = new Store();
  const subject = new SheetResource(`${urls.descriptor}#it`, dataset, DataFactory);
  subject.types.add(`${SCHEMA}Dataset`);
  subject.setText(`${SCHEMA}name`, descriptor.name);
  subject.setIri(`${SCHEMA}distribution`, urls.csv);
  descriptor.columns.forEach((column, index) => {
    const url = `${urls.descriptor}#column-${index + 1}`;
    subject.links(`${SCHEMA}variableMeasured`).add(url);
    const variable = new SheetResource(url, dataset, DataFactory);
    variable.types.add(`${SCHEMA}PropertyValue`);
    variable.position = index + 1;
    variable.setText(`${SCHEMA}name`, column.name);
    variable.setIri(`${SCHEMA}additionalType`, DATATYPES[column.type]);
    variable.setText(`${SCHEMA}encodingFormat`, column.format);
  });
  return dataset;
}
export function inferDescriptor(name: string, grid: Grid): SheetDescriptor {
  return { name, columns: inferColumns(grid) };
}

/** A real RDF/JS serializer emits expanded JSON-LD; no remote context is needed. */
export async function serializeDescriptor(
  container: string,
  number: number,
  descriptor: SheetDescriptor,
): Promise<string> {
  const serializer = new JsonLdSerializer();
  const result = new Promise<string>((resolve, reject) => {
    let json = "";
    serializer.on("data", (chunk: string) => {
      json += chunk;
    });
    serializer.on("error", reject);
    serializer.on("end", () => resolve(json));
  });
  for (const quad of descriptorDataset(container, number, descriptor)) serializer.write(quad);
  serializer.end();
  return result;
}

export async function parseDescriptor(
  container: string,
  number: number,
  json: string,
): Promise<SheetDescriptor> {
  // Expanded descriptors are context-free. Reject contexts (including scoped/imported ones)
  // before the shared parser can dereference an attacker-controlled context URL.
  JSON.parse(json, (key, value: unknown) => {
    if (key === "@context")
      throw new TypeError("Descriptors must use expanded, context-free JSON-LD");
    return value;
  });
  const urls = workbookLayout(container).sheet(number);
  const dataset = await parseRdf(json, "application/ld+json", { baseIRI: urls.descriptor });
  const subject = new SheetResource(`${urls.descriptor}#it`, dataset, DataFactory);
  if (!subject.types.has(`${SCHEMA}Dataset`) || subject.iri(`${SCHEMA}distribution`) !== urls.csv) {
    throw new TypeError("Invalid descriptor dataset");
  }
  const variables = [...subject.links(`${SCHEMA}variableMeasured`)]
    .map((url) => {
      const variable = new SheetResource(url, dataset, DataFactory);
      const datatype = variable.iri(`${SCHEMA}additionalType`);
      const type = (Object.keys(DATATYPES) as ColumnType[]).find(
        (key) => DATATYPES[key] === datatype,
      );
      if (!type || !variable.types.has(`${SCHEMA}PropertyValue`))
        throw new TypeError("Invalid column variable");
      return {
        position: required(variable.position),
        column: {
          name: required(variable.text(`${SCHEMA}name`)),
          type,
          format: required(variable.text(`${SCHEMA}encodingFormat`)) as Column["format"],
        },
      };
    })
    .sort((a, b) => a.position - b.position);
  if (variables.some((variable, i) => variable.position !== i + 1))
    throw new TypeError("Invalid column order");
  const descriptor = {
    name: required(subject.text(`${SCHEMA}name`)),
    columns: variables.map((variable) => variable.column),
  };
  descriptorDataset(container, number, descriptor);
  return descriptor;
}
