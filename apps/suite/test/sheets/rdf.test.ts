// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Literal } from "@rdfjs/types";
import { JsonLdSerializer } from "jsonld-streaming-serializer";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  DCT,
  descriptorDataset,
  httpIri,
  inferDescriptor,
  parseDescriptor,
  parseWorkbook,
  readWorkbookDataset,
  SCHEMA,
  type SheetDescriptor,
  SheetResource,
  SPREADSHEET_CLASS,
  serializeDescriptor,
  serializeWorkbook,
  workbookDataset,
  workbookLayout,
  XSD,
} from "../../src/apps/sheets/lib/model";
import { BOOK, GRID, META } from "./fixtures";

async function jsonld(dataset: Store): Promise<string> {
  const serializer = new JsonLdSerializer();
  const output = new Promise<string>((resolve, reject) => {
    let text = "";
    serializer.on("data", (chunk: string) => {
      text += chunk;
    });
    serializer.on("error", reject);
    serializer.on("end", () => resolve(text));
  });
  for (const quad of dataset) serializer.write(quad);
  serializer.end();
  return output;
}

describe("spreadsheet RDF layout and metadata", () => {
  it("maps container paths and validates HTTP IRIs and positive sheet numbers", () => {
    const layout = workbookLayout(BOOK);
    expect(layout.index).toBe(`${BOOK}index.ttl`);
    expect(layout.subject).toBe(`${BOOK}index.ttl#it`);
    expect(layout.snapshot).toBe(`${BOOK}workbook.json`);
    expect(layout.sheet(2)).toEqual({
      csv: `${BOOK}sheets/2.csv`,
      descriptor: `${BOOK}sheets/2.jsonld`,
    });
    for (const number of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => layout.sheet(number)).toThrow(TypeError);
    for (const url of [
      "relative/",
      "javascript:alert(1)",
      "https://user:pass@example.org/",
      "https://user@example.org/",
      "https://example.org/file",
      `${BOOK}?x`,
      `${BOOK}#it`,
    ]) {
      expect(() => workbookLayout(url)).toThrow(TypeError);
    }
    expect(httpIri("https://example.org/a>evil")).toBe("https://example.org/a%3Eevil");
  });
  it("round-trips typed index metadata, CSV downloads and dates without input mutation", async () => {
    const turtle = await serializeWorkbook(BOOK, META);
    const dataset = await parseRdf(turtle, "text/turtle");
    expect(await parseWorkbook(BOOK, turtle)).toEqual(META);
    expect(turtle).toContain("SpreadsheetDigitalDocument");
    const subject = new SheetResource(workbookLayout(BOOK).subject, dataset, DataFactory);
    expect(subject.types).toContain(`${SCHEMA}Dataset`);
    expect(subject.iri(`${SCHEMA}encoding`)).toBe(`${BOOK}workbook.json`);
    expect([...subject.links(`${SCHEMA}hasPart`)]).toEqual([
      `${BOOK}sheets/1.csv`,
      `${BOOK}sheets/2.csv`,
    ]);
    expect(META.sheets).toHaveLength(2);
    expect(
      await parseWorkbook(BOOK, await serializeWorkbook(BOOK, { ...META, sheets: [] })),
    ).toEqual({ ...META, sheets: [] });
    expect(
      readWorkbookDataset(
        BOOK,
        workbookDataset(BOOK, { ...META, sheets: [...META.sheets].reverse() }),
      ),
    ).toEqual(META);
  });
  it("writes creation and modification timestamps as xsd:dateTime, including updates", async () => {
    const dataset = await parseRdf(await serializeWorkbook(BOOK, META), "text/turtle");
    const subject = DataFactory.namedNode(workbookLayout(BOOK).subject);
    const timestamp = (predicate: string) =>
      [...dataset.match(subject, DataFactory.namedNode(predicate))].map((quad) => ({
        value: quad.object.value,
        datatype: (quad.object as Literal).datatype.value,
      }));
    expect(timestamp(`${DCT}created`)).toEqual([
      { value: META.created.toISOString(), datatype: `${XSD}dateTime` },
    ]);
    expect(timestamp(`${DCT}modified`)).toEqual([
      { value: META.modified.toISOString(), datatype: `${XSD}dateTime` },
    ]);
    const modified = new Date("2026-10-26T12:34:56.789Z");
    new SheetResource(subject, dataset, DataFactory).date = modified;
    expect(timestamp(`${DCT}modified`)).toEqual([
      { value: modified.toISOString(), datatype: `${XSD}dateTime` },
    ]);
    expect(readWorkbookDataset(BOOK, dataset)).toEqual({ ...META, modified });
  });
  it("rejects invalid metadata and malformed RDF independently of parser errors", async () => {
    expect(() =>
      workbookDataset(BOOK, {
        ...META,
        sheets: [
          { number: 1, name: "First" },
          { number: 1, name: "Duplicate" },
        ],
      }),
    ).toThrow("Duplicate");
    expect(() => workbookDataset(BOOK, { ...META, created: new Date(NaN) })).toThrow("date");
    expect(() => workbookDataset(BOOK, { ...META, modified: new Date(NaN) })).toThrow("date");
    expect(() => readWorkbookDataset(BOOK, new Store())).toThrow("not a spreadsheet");
    const missingType = workbookDataset(BOOK, META);
    new SheetResource(`${BOOK}index.ttl#it`, missingType, DataFactory).types.delete(
      `${SCHEMA}Dataset`,
    );
    expect(() => readWorkbookDataset(BOOK, missingType)).toThrow("not a spreadsheet");
    const minimal = new Store();
    const subject = new SheetResource(`${BOOK}index.ttl#it`, minimal, DataFactory);
    subject.types.add(SPREADSHEET_CLASS);
    subject.types.add(`${SCHEMA}Dataset`);
    expect(() => readWorkbookDataset(BOOK, minimal)).toThrow("Missing");
    for (const change of [
      (sheet: SheetResource) => sheet.types.clear(),
      (sheet: SheetResource) => sheet.setText(`${SCHEMA}encodingFormat`, "application/json"),
      (sheet: SheetResource) => sheet.setIri(`${SCHEMA}contentUrl`, "https://evil.example/"),
      (sheet: SheetResource) => sheet.setIri(`${SCHEMA}subjectOf`, "https://evil.example/"),
      (sheet: SheetResource) => {
        sheet.position = 2;
      },
      (sheet: SheetResource) => {
        sheet.position = 0;
      },
    ]) {
      const dataset = workbookDataset(BOOK, META);
      change(new SheetResource(`${BOOK}sheets/1.csv`, dataset, DataFactory));
      expect(() => readWorkbookDataset(BOOK, dataset)).toThrow(TypeError);
    }
    await expect(parseWorkbook(BOOK, "this is not turtle")).rejects.toThrow();
  });
});

describe("per-sheet JSON-LD descriptors", () => {
  it("infers and round-trips ordered columns with standard schema and XSD terms", async () => {
    const descriptor = inferDescriptor("Income", GRID);
    const json = await serializeDescriptor(BOOK, 1, descriptor);
    expect(json).toContain(`${SCHEMA}variableMeasured`);
    expect(json).toContain(`${XSD}double`);
    expect(json).not.toContain("@context");
    expect(await parseDescriptor(BOOK, 1, json)).toEqual(descriptor);
    const dataset = descriptorDataset(BOOK, 1, descriptor);
    const reordered = new Store([...dataset].reverse());
    expect(await parseDescriptor(BOOK, 1, await jsonld(reordered))).toEqual(descriptor);
  });
  it("rejects missing columns and invalid column types and formats", async () => {
    for (const columns of [
      [],
      [{ name: "a", type: "unknown", format: "text" }],
      [{ name: "a", type: "date", format: "text" }],
    ]) {
      await expect(
        serializeDescriptor(BOOK, 1, { name: "a", columns } as SheetDescriptor),
      ).rejects.toThrow(TypeError);
    }
    await expect(parseDescriptor(BOOK, 1, '{"@context":"https://evil.example/"}')).rejects.toThrow(
      "context-free",
    );
    await expect(parseDescriptor(BOOK, 1, '{"x":{"@context":{}}}')).rejects.toThrow("context-free");
    await expect(parseDescriptor(BOOK, 1, "{")).rejects.toThrow();
    await expect(parseDescriptor(BOOK, 1, "[]")).rejects.toThrow("Invalid descriptor");
  });
  it("validates descriptor identity, distribution, variable type, order, and required fields", async () => {
    const descriptor = inferDescriptor("Income", GRID);
    for (const change of [
      (dataset: Store) =>
        new SheetResource(`${BOOK}sheets/1.jsonld#it`, dataset, DataFactory).setIri(
          `${SCHEMA}distribution`,
          "https://evil.example/",
        ),
      (dataset: Store) =>
        new SheetResource(`${BOOK}sheets/1.jsonld#column-1`, dataset, DataFactory).setIri(
          `${SCHEMA}additionalType`,
          `${XSD}boolean`,
        ),
      (dataset: Store) =>
        new SheetResource(`${BOOK}sheets/1.jsonld#column-1`, dataset, DataFactory).types.clear(),
      (dataset: Store) => {
        new SheetResource(`${BOOK}sheets/1.jsonld#column-1`, dataset, DataFactory).position = 0;
      },
      (dataset: Store) => {
        new SheetResource(`${BOOK}sheets/1.jsonld#column-1`, dataset, DataFactory).position = 2;
      },
      (dataset: Store) =>
        new SheetResource(`${BOOK}sheets/1.jsonld#column-1`, dataset, DataFactory).setText(
          `${SCHEMA}encodingFormat`,
          "bad",
        ),
      (dataset: Store) =>
        new SheetResource(`${BOOK}sheets/1.jsonld#it`, dataset, DataFactory)
          .links(`${SCHEMA}variableMeasured`)
          .clear(),
    ]) {
      const dataset = descriptorDataset(BOOK, 1, descriptor);
      change(dataset);
      await expect(parseDescriptor(BOOK, 1, await jsonld(dataset))).rejects.toThrow(TypeError);
    }
    const missing = new Store();
    const subject = new SheetResource(`${BOOK}sheets/1.jsonld#it`, missing, DataFactory);
    subject.types.add(`${SCHEMA}Dataset`);
    subject.setIri(`${SCHEMA}distribution`, `${BOOK}sheets/1.csv`);
    await expect(parseDescriptor(BOOK, 1, await jsonld(missing))).rejects.toThrow("Missing");
    const invalidLiteral = workbookDataset(BOOK, META);
    new SheetResource(`${BOOK}index.ttl#it`, invalidLiteral, DataFactory).setIri(
      `${DCT}title`,
      "https://example.org/",
    );
    expect(() => readWorkbookDataset(BOOK, invalidLiteral)).toThrow();
  });
});
