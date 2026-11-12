// AUTHORED-BY Codex (GPT-6.1 Sol)
import { readFileSync } from "node:fs";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  DCT,
  descriptorDataset,
  inferDescriptor,
  parseDescriptor,
  RDF,
  readWorkbookDataset,
  SCHEMA,
  SheetResource,
  serializeDescriptor,
  serializeWorkbook,
  sheetRegistrations,
  workbookDataset,
  XSD,
} from "../src/index.js";
import { BOOK, GRID, META } from "./fixtures.js";

const { namedNode, literal, quad } = DataFactory;
const workbook = `${BOOK}index.ttl#it`;
const download = `${BOOK}sheets/1.csv`;
const descriptor = `${BOOK}sheets/1.jsonld#it`;
const column = `${BOOK}sheets/1.jsonld#column-1`;

function replace(
  store: Store,
  subject: string,
  predicate: string,
  ...values: ReturnType<typeof literal>[]
): Store {
  store.deleteMatches(namedNode(subject), namedNode(predicate));
  for (const value of values) store.add(quad(namedNode(subject), namedNode(predicate), value));
  return store;
}
async function descriptorJson(store: Store): Promise<string> {
  const { JsonLdSerializer } = await import("jsonld-streaming-serializer");
  const serializer = new JsonLdSerializer();
  const chunks: string[] = [];
  const output = new Promise<string>((resolve, reject) => {
    serializer.on("data", (chunk: string) => chunks.push(chunk));
    serializer.on("end", () => resolve(chunks.join("")));
    serializer.on("error", reject);
  });
  for (const value of store) serializer.write(value);
  serializer.end();
  return output;
}

it("preserves both original serializers' bytes and every written IRI", async () => {
  // Captured by running the original app implementation from HEAD before the flip.
  expect(await serializeWorkbook(BOOK, META)).toBe(
    readFileSync(new URL("./fixtures/workbook.ttl", import.meta.url), "utf8"),
  );
  expect(await serializeDescriptor(BOOK, 1, inferDescriptor("Income", GRID))).toBe(
    readFileSync(new URL("./fixtures/descriptor.jsonld.txt", import.meta.url), "utf8"),
  );
});

describe("exact generated read divergences", () => {
  it.each([
    [workbook, `${DCT}title`, [literal("First"), literal("Second")]],
    [workbook, `${DCT}title`, [literal("Titre", "fr")]],
    [workbook, `${DCT}title`, [literal("5", namedNode(`${XSD}integer`))]],
    [workbook, `${DCT}created`, [literal("2026-10-24", namedNode(`${XSD}date`))]],
    [workbook, `${DCT}modified`, [literal("2026-02-30T00:00:00Z", namedNode(`${XSD}dateTime`))]],
    [download, `${SCHEMA}name`, [literal("Name", "en")]],
    [download, `${SCHEMA}position`, [literal("1", namedNode(`${XSD}double`))]],
    [
      download,
      `${SCHEMA}position`,
      [literal("1", namedNode(`${XSD}integer`)), literal("2", namedNode(`${XSD}integer`))],
    ],
    [download, `${SCHEMA}position`, [literal("9007199254740993", namedNode(`${XSD}integer`))]],
  ] as const)("rejects malformed or ambiguous %s %s", (subject, predicate, values) => {
    expect(() =>
      readWorkbookDataset(
        BOOK,
        replace(workbookDataset(BOOK, META), subject, predicate, ...values),
      ),
    ).toThrow(TypeError);
  });

  it.each([
    [descriptor, `${SCHEMA}name`, [literal("a"), literal("b")]],
    [descriptor, `${SCHEMA}name`, [literal("Name", "en")]],
    [column, `${SCHEMA}name`, [literal("Name", "en")]],
    [column, `${SCHEMA}position`, [literal("1", namedNode(`${XSD}double`))]],
    [column, `${SCHEMA}encodingFormat`, [literal("text"), literal("number")]],
  ] as const)("rejects malformed descriptor metadata %s %s", async (subject, predicate, values) => {
    const store = replace(
      descriptorDataset(BOOK, 1, inferDescriptor("Income", GRID)),
      subject,
      predicate,
      ...values,
    );
    await expect(parseDescriptor(BOOK, 1, await descriptorJson(store))).rejects.toThrow(TypeError);
  });

  it("rejects invalid collection members without dropping a sheet or column", async () => {
    const store = workbookDataset(BOOK, META);
    store.add(quad(namedNode(workbook), namedNode(`${SCHEMA}hasPart`), literal("bad")));
    expect(() => readWorkbookDataset(BOOK, store)).toThrow(TypeError);
    const columns = descriptorDataset(BOOK, 1, inferDescriptor("Income", GRID));
    columns.add(
      quad(namedNode(descriptor), namedNode(`${SCHEMA}variableMeasured`), literal("bad")),
    );
    await expect(parseDescriptor(BOOK, 1, await descriptorJson(columns))).rejects.toThrow(
      TypeError,
    );
  });

  it("recognises data-graph subclasses for downloads, descriptors and columns", async () => {
    function subclass(store: Store, subject: string, type: string) {
      const sub = `${type}Subclass`;
      store.deleteMatches(namedNode(subject), namedNode(`${RDF}type`), namedNode(type));
      store.add(quad(namedNode(subject), namedNode(`${RDF}type`), namedNode(sub)));
      store.add(
        quad(
          namedNode(sub),
          namedNode("http://www.w3.org/2000/01/rdf-schema#subClassOf"),
          namedNode(type),
        ),
      );
    }
    const store = workbookDataset(BOOK, META);
    subclass(store, download, `${SCHEMA}DataDownload`);
    expect(readWorkbookDataset(BOOK, store)).toEqual(META);
    const columns = descriptorDataset(BOOK, 1, inferDescriptor("Income", GRID));
    subclass(columns, descriptor, `${SCHEMA}Dataset`);
    subclass(columns, column, `${SCHEMA}PropertyValue`);
    expect(await parseDescriptor(BOOK, 1, await descriptorJson(columns))).toEqual(
      inferDescriptor("Income", GRID),
    );
    subclass(store, workbook, `${SCHEMA}SpreadsheetDigitalDocument`);
    expect(() => readWorkbookDataset(BOOK, store)).toThrow("not a spreadsheet");
  });
});

it("retains identical collection values repeated in named graphs", () => {
  const store = workbookDataset(BOOK, META);
  store.add(
    quad(
      namedNode(workbook),
      namedNode(`${SCHEMA}hasPart`),
      namedNode(download),
      namedNode("https://pod.example/graph"),
    ),
  );
  expect(readWorkbookDataset(BOOK, store)).toEqual(META);
});

it("strips controls from generated text writes while retaining tabs and newlines", async () => {
  const dirty = {
    ...META,
    title: "A\u0000B\u0081\t\n",
    sheets: [{ number: 1, name: "N\u0001ame" }],
  };
  expect(readWorkbookDataset(BOOK, workbookDataset(BOOK, dirty))).toEqual({
    ...dirty,
    title: "AB\t\n",
    sheets: [{ number: 1, name: "Name" }],
  });
  const descriptor = {
    name: "A\u0000B",
    columns: [{ name: "C\u0001D", type: "text", format: "text" }],
  } as const;
  expect(
    await parseDescriptor(
      BOOK,
      1,
      await serializeDescriptor(BOOK, 1, { ...descriptor, columns: [...descriptor.columns] }),
    ),
  ).toEqual({ name: "AB", columns: [{ name: "CD", type: "text", format: "text" }] });
});

it("preserves the generic compatibility view, including blank-node registrations", () => {
  const store = new Store();
  const view = new SheetResource(DataFactory.blankNode("registration"), store, DataFactory);
  view.types.add("http://www.w3.org/ns/solid/terms#TypeRegistration");
  view.setIri("http://www.w3.org/ns/solid/terms#instance", workbook);
  expect(view.iri("http://www.w3.org/ns/solid/terms#instance")).toBe(workbook);
  expect(
    [...sheetRegistrations(store)].map((registration) =>
      registration.iri("http://www.w3.org/ns/solid/terms#instance"),
    ),
  ).toEqual([workbook]);
  view.setText(`${SCHEMA}name`, "A\u0000B");
  expect(view.text(`${SCHEMA}name`)).toBe("A\u0000B");
  replace(store, workbook, `${DCT}modified`, literal("2026-10-25", namedNode(`${XSD}date`)));
  const metadata = new SheetResource(workbook, store, DataFactory);
  expect(metadata.date).toEqual(new Date("2026-10-25"));
  replace(store, download, `${SCHEMA}position`, literal("1", namedNode(`${XSD}double`)));
  expect(new SheetResource(download, store, DataFactory).position).toBe(1);
});
