// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { JsonLdSerializer } from "jsonld-streaming-serializer";
import type { Store } from "n3";
import { type Column, type ColumnType, validateColumns } from "./columns.js";
import { entities } from "./generated/model.js";
import { workbookLayout } from "./layout.js";
import { RDF, SCHEMA, XSD } from "./vocab.js";
import { checkedLinks, orderedDataset, required } from "./workbook.js";

const DATATYPES = {
  text: `${XSD}string`,
  number: `${XSD}double`,
  date: `${XSD}dateTime`,
} as const satisfies Record<ColumnType, string>;
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
  const dataset = entities.Descriptor.build(urls.descriptor, {
    name: descriptor.name,
    distribution: urls.csv,
    variableMeasured: descriptor.columns.map(
      (_, index) => `${urls.descriptor}#column-${index + 1}`,
    ),
  });
  descriptor.columns.forEach((column, index) => {
    dataset.addAll(
      entities.Column.build(`${urls.descriptor}#column-${index + 1}`, {
        position: index + 1,
        name: column.name,
        additionalType: DATATYPES[column.type],
        encodingFormat: column.format,
      }),
    );
  });
  return orderedDataset(dataset, [
    `${RDF}type`,
    `${SCHEMA}position`,
    `${SCHEMA}name`,
    `${SCHEMA}distribution`,
    `${SCHEMA}variableMeasured`,
    `${SCHEMA}additionalType`,
    `${SCHEMA}encodingFormat`,
  ]);
}

/** Context-free expanded JSON-LD over the generated dataset, as in the original app. */
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
  // Reject scoped/imported contexts before the parser could fetch a context URL.
  JSON.parse(json, (key, value: unknown) => {
    if (key === "@context")
      throw new TypeError("Descriptors must use expanded, context-free JSON-LD");
    return value;
  });
  const urls = workbookLayout(container).sheet(number);
  const dataset = await parseRdf(json, "application/ld+json", { baseIRI: urls.descriptor });
  const core = entities.Descriptor.parse(urls.descriptor, dataset);
  if (!core || core.distribution !== urls.csv) throw new TypeError("Invalid descriptor dataset");
  const name = required(core.name);
  const variables = checkedLinks(
    dataset,
    `${urls.descriptor}#it`,
    `${SCHEMA}variableMeasured`,
    core.variableMeasured,
  )
    .map((url) => {
      const variable = required(entities.Column.parse(url, dataset));
      const type = (Object.keys(DATATYPES) as ColumnType[]).find(
        (key) => DATATYPES[key] === variable.additionalType,
      );
      if (!type) throw new TypeError("Invalid column variable");
      return {
        position: variable.position,
        column: { name: variable.name, type, format: variable.encodingFormat as Column["format"] },
      };
    })
    .sort((a, b) => a.position - b.position);
  // SHACL cannot express contiguous list positions or the datatype/format pairing.
  if (variables.some((variable, i) => variable.position !== i + 1))
    throw new TypeError("Invalid column order");
  const descriptor = { name, columns: variables.map((variable) => variable.column) };
  descriptorDataset(container, number, descriptor);
  return descriptor;
}
