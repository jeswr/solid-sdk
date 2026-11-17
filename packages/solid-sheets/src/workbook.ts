// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { entities } from "./generated/model.js";
import { httpIri, workbookLayout } from "./layout.js";
import { DCT, RDF, SCHEMA, SPREADSHEET_CLASS } from "./vocab.js";

export interface WorkbookMetadata {
  title: string;
  created: Date;
  modified: Date;
  creator: string;
  sheets: { number: number; name: string }[];
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Missing spreadsheet metadata");
  return value;
}
function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError("Invalid metadata date");
  return value;
}
/** Flat generated entities let the facade compose any number of downloads. */
export function workbookDataset(container: string, metadata: WorkbookMetadata): Store {
  const layout = workbookLayout(container);
  const dataset = entities.Workbook.build(layout.index, {
    title: metadata.title,
    created: validDate(metadata.created),
    modified: validDate(metadata.modified),
    creator: httpIri(metadata.creator),
    encoding: layout.snapshot,
    hasPart: metadata.sheets.map((sheet) => layout.sheet(sheet.number).csv),
  });
  // The app's workbook has two simultaneous canonical types, not read aliases.
  new entities.Workbook.Wrapper(layout.subject, dataset, DataFactory).types.add(`${SCHEMA}Dataset`);
  const seen = new Set<number>();
  for (const sheet of metadata.sheets) {
    const urls = layout.sheet(sheet.number);
    if (seen.has(sheet.number)) throw new TypeError("Duplicate sheet number");
    seen.add(sheet.number);
    dataset.addAll(
      entities.Download.build(urls.csv, {
        name: sheet.name,
        encodingFormat: "text/csv",
        contentUrl: urls.csv,
        subjectOf: urls.descriptor,
        position: sheet.number,
      }),
    );
  }
  return orderedDataset(dataset, [
    `${RDF}type`,
    `${DCT}title`,
    `${DCT}created`,
    `${DCT}modified`,
    `${DCT}creator`,
    `${SCHEMA}encoding`,
    `${SCHEMA}hasPart`,
    `${SCHEMA}name`,
    `${SCHEMA}encodingFormat`,
    `${SCHEMA}contentUrl`,
    `${SCHEMA}subjectOf`,
    `${SCHEMA}position`,
  ]);
}

/** Keep the original serializers' subject and property insertion order. */
export function orderedDataset(dataset: Store, predicates: string[]): Store {
  const subjects = new Map(
    [...new Set([...dataset].map((quad) => quad.subject.value))].map((value, index) => [
      value,
      index,
    ]),
  );
  return new Store(
    [...dataset].sort(
      (left, right) =>
        (subjects.get(left.subject.value) ?? 0) - (subjects.get(right.subject.value) ?? 0) ||
        predicates.indexOf(left.predicate.value) - predicates.indexOf(right.predicate.value),
    ),
  );
}

/** Require every raw collection member to survive generated term guards. */
export function checkedLinks(
  dataset: DatasetCore,
  subject: string,
  predicate: string,
  values: string[] = [],
): string[] {
  const terms = [
    ...dataset.match(DataFactory.namedNode(subject), DataFactory.namedNode(predicate)),
  ].map((quad) => quad.object);
  if (
    terms.some((term) => term.termType !== "NamedNode") ||
    new Set(terms.map((term) => term.value)).size !== values.length
  )
    throw new TypeError("Invalid spreadsheet links");
  return values;
}

export function readWorkbookDataset(container: string, dataset: DatasetCore): WorkbookMetadata {
  const layout = workbookLayout(container);
  const wrapper = new entities.Workbook.Wrapper(layout.subject, dataset, DataFactory);
  if (!wrapper.types.has(SPREADSHEET_CLASS) || !wrapper.types.has(`${SCHEMA}Dataset`))
    throw new TypeError("Resource is not a spreadsheet dataset");
  const core = required(entities.Workbook.parse(layout.index, dataset));
  const metadata: WorkbookMetadata = {
    title: core.title,
    created: core.created,
    modified: core.modified,
    creator: httpIri(core.creator),
    sheets: checkedLinks(dataset, layout.subject, `${SCHEMA}hasPart`, core.hasPart)
      .map((url) => {
        const download = entities.Download.parse(url, dataset);
        if (!download) throw new TypeError("Invalid sheet download");
        const urls = layout.sheet(download.position);
        if (
          url !== urls.csv ||
          download.encodingFormat !== "text/csv" ||
          download.contentUrl !== urls.csv ||
          download.subjectOf !== urls.descriptor
        )
          throw new TypeError("Invalid sheet download");
        return { number: download.position, name: download.name };
      })
      .sort((a, b) => a.number - b.number),
  };
  // Cross-record uniqueness and layout are domain policy, independent of SHACL.
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
