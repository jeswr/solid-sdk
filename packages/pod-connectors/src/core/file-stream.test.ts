// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { type ImportFile, MAX_FILE_BYTES } from "./file-import.js";
import { jsonEntries } from "./file-json.js";
import { csvRows, fileText, textLines, xmlTags } from "./file-stream.js";
import { sourceItemUrl } from "./slug.js";
import { memoryFile } from "./testing.js";

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
