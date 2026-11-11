// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import * as csv from "./csv.js";
import { type ImportFile, MAX_FILE_BYTES } from "./file-import.js";
import { jsonEntries } from "./file-json.js";
import { csvRows, fileText, textLines, xmlTags } from "./file-stream.js";
import { sourceItemUrl } from "./slug.js";
import { fileImport, memoryFile } from "./testing.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

function chunksFile(text: string): ImportFile {
  const bytes = new TextEncoder().encode(text);
  return {
    ...memoryFile("export", text),
    stream: () => {
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) controller.close();
          else controller.enqueue(bytes.slice(offset, ++offset));
        },
      });
    },
  };
}

describe("bounded file readers", () => {
  it.each(["shared", "bank"])("parses the %s CSV header once for many records", async (path) => {
    const header = ' Date , Description , Amount ,"Synthetic, extra"';
    const records = Array.from({ length: 32 }, (_, i) => `2026-01-01,Item ${i},-${i + 1}`);
    const parse = vi.spyOn(csv, "parseCsv");
    try {
      const file = chunksFile(`${header}\r\n${records.join("\r\n")}`);
      if (path === "bank") {
        const { report } = await fileImport(bankStatementsFileAdapter, file);
        expect(report.written).toHaveLength(1);
      } else {
        const rows = await collect(csvRows(file));
        expect(rows).toHaveLength(records.length);
        expect(rows[0]).toEqual({
          Date: "2026-01-01",
          Description: "Item 0",
          Amount: "-1",
          "Synthetic, extra": "",
        });
      }
      expect(parse).toHaveBeenCalledExactlyOnceWith(header);
    } finally {
      parse.mockRestore();
    }
  });

  it.each([
    "x".repeat(csv.MAX_CSV_HEADER_CHARS + 1),
    `"${"x".repeat(csv.MAX_CSV_HEADER_CHARS)}`,
    Array.from({ length: csv.MAX_CSV_COLUMNS + 1 }, (_, i) => `Column ${i}`).join(","),
  ])("rejects oversized headers before processing rows (%#)", async (header) => {
    const file = memoryFile("statement.csv", `${header}\n2026-01-01,Synthetic,-1`);
    await expect(collect(csvRows(file))).rejects.toThrow("CSV header exceeds");
    await expect(fileImport(bankStatementsFileAdapter, file)).rejects.toThrow("CSV header exceeds");
  });

  it("preserves header trimming, empty cells, duplicate columns and row padding", async () => {
    const text = '\uFEFF A , B , A ,C\nfirst," second ",last\nonly\n1,2,3,4';
    expect(await collect(csvRows(chunksFile(text)))).toEqual(csv.parseCsv(text).rows);
  });

  it("skips extra CSV cells including quoted delimiters, newlines and trailing empty fields", async () => {
    const skip = vi.fn();
    const text = 'A,B\n1,2,\n1,2,"ignored,\n""quoted""",more\nlast,kept\n1,2,extra';
    expect(await collect(csvRows(chunksFile(text), skip))).toEqual([{ A: "last", B: "kept" }]);
    expect(skip).toHaveBeenCalledTimes(3);
  });

  it.each(["", " \r\n", "Date,Description,Amount"])("handles empty CSV data %j", async (text) => {
    expect(await collect(csvRows(chunksFile(text)))).toEqual([]);
  });

  it("decodes UTF-8 split across bytes and preserves a final unterminated line", async () => {
    expect(await collect(textLines(fileText(chunksFile("café 🌍\r\nlast\rnext\n"))))).toEqual([
      "café 🌍",
      "last",
      "next",
    ]);
  });

  it("reads quoted CSV newlines, escapes, CRLF and a final row without a newline", async () => {
    expect(
      await collect(csvRows(chunksFile('\uFEFFName,Value\r\n"A, ""B""\nC",1\r\nD,2'))),
    ).toEqual([
      { Name: 'A, "B"\nC', Value: "1" },
      { Name: "D", Value: "2" },
    ]);
  });

  it("ignores XML comments and CDATA, respects quoted >, and never expands external entities", async () => {
    const xml =
      '<!DOCTYPE HealthData SYSTEM "https://invalid.test/external"><HealthData><!--<Workout/>--><![CDATA[<Workout/>]]><Workout name="A > B &external;"/></HealthData>';
    expect(await collect(xmlTags(fileText(chunksFile(xml))))).toEqual([
      '<!DOCTYPE HealthData SYSTEM "https://invalid.test/external">',
      "<HealthData>",
      '<Workout name="A > B &external;"/>',
      "</HealthData>",
    ]);
  });

  it("enforces actual bytes even when a stream under-reports size, and cancels it", async () => {
    const cancel = vi.fn();
    const block = new Uint8Array(1024 * 1024);
    const file: ImportFile = {
      ...memoryFile("export", ""),
      size: 1,
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(block);
          },
          cancel,
        }),
    };
    await expect(collect(fileText(file))).rejects.toThrow("64 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("checks actual text-only bytes for legacy hosts", async () => {
    const file = { ...memoryFile("export", ""), text: async () => "x".repeat(MAX_FILE_BYTES + 1) };
    await expect(collect(fileText(file))).rejects.toThrow("64 MiB");
  });

  it("cancels the stream and releases its reader when a consumer stops early", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([65]));
      },
      cancel,
    });
    for await (const _chunk of fileText({ ...memoryFile("export", ""), stream: () => stream }))
      break;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("releases a reader after a source read failure", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("Synthetic read failure"));
      },
    });
    await expect(
      collect(fileText({ ...memoryFile("export", ""), stream: () => stream })),
    ).rejects.toThrow("Synthetic read failure");
    expect(stream.locked).toBe(false);
  });
});

describe("streaming JSON selectors", () => {
  it.each([
    ['[null,{"name":"A"},false,1,"text"]', [""], [], [null, { name: "A" }, false, 1, "text"]],
    [
      '{"response":{"games":[{"name":"A"}]},"personaname":"Synthetic"}',
      ["response.games"],
      ["personaname"],
      [{ name: "A" }, "Synthetic"],
    ],
    ['{"ignored":{"array":[1,true,null,{},[]]},"conversations":[]}', ["conversations"], [], []],
  ] as const)("selects records from %s", async (text, paths, fields, values) => {
    const entries = await collect(jsonEntries(chunksFile(text), paths, fields));
    expect(entries.map((entry) => entry.value)).toEqual(values);
  });

  it.each([
    '[{"a":1 2}]',
    '[{"a":truefalse}]',
    "[1,]",
    '{"a" 1}',
    "{a:1}",
    '["unterminated]',
    "[{}",
    "[] false",
    "[{]",
    '{"a":1,}',
  ])("rejects malformed input %s", async (text) => {
    await expect(collect(jsonEntries(chunksFile(text), [""]))).rejects.toThrow();
  });

  it("rejects excessive nesting in selected and unselected records", async () => {
    const deep = `${"[".repeat(70)}0${"]".repeat(70)}`;
    await expect(collect(jsonEntries(chunksFile(deep), [""]))).rejects.toThrow("deeply");
    await expect(collect(jsonEntries(chunksFile(deep), []))).rejects.toThrow("deeply");
  });
});

it("keeps untrusted source ids inside one URL segment and drops invalid Unicode", () => {
  expect(sourceItemUrl("https://source.test/item/", "a/?#<b>")).toBe(
    "https://source.test/item/a%2F%3F%23%3Cb%3E",
  );
  expect(sourceItemUrl("https://source.test/item/", "\ud800")).toBeUndefined();
  expect(sourceItemUrl("https://source.test/item/", undefined)).toBeUndefined();
});
