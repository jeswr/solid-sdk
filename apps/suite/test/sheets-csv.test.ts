// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CSV_LIMITS,
  type CsvDelimiter,
  CsvError,
  type CsvErrorCode,
  inferColumnTypes,
  parseCsv,
  serializeCsv,
  sniffDelimiter,
} from "../src/apps/sheets/lib/csv";

function fails(code: CsvErrorCode, action: () => unknown) {
  expect(action).toThrow(CsvError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ name: "CsvError", code });
  }
}

describe("CSV records and quotes", () => {
  it.each([
    ["", []],
    ["\uFEFF", []],
    ["\n", [[""]]],
    ["\r\n\n", [[""], [""]]],
    ['""', [[""]]],
    ['""\r\n', [[""]]],
    [",", [["", ""]]],
    [",\r\n", [["", ""]]],
    ["a,b,", [["a", "b", ""]]],
    [
      "a,b\nc,d",
      [
        ["a", "b"],
        ["c", "d"],
      ],
    ],
    [
      "a,b\r\nc,d\n",
      [
        ["a", "b"],
        ["c", "d"],
      ],
    ],
    ['"a,b","Dana ""Example"""', [["a,b", 'Dana "Example"']]],
    ['"\n\r\n\r",tail\r\n', [["\n\r\n\r", "tail"]]],
    ["\uFEFF name ,é🙂\r\n", [[" name ", "é🙂"]]],
    ['"\uFEFFcontent"', [["\uFEFFcontent"]]],
    ["\uFEFF\uFEFFcontent", [["\uFEFFcontent"]]],
    ["=SUM(A1:A2),+1", [["=SUM(A1:A2)", "+1"]]],
  ])("preserves %j", (source, rows) => {
    expect(parseCsv(source, { delimiter: "," })).toEqual(rows);
  });

  it.each([
    '"unclosed',
    'a"b',
    '"a" b',
    '"a"b',
    '"a""',
    "a\r",
    "a\rb",
    '"a"\r',
  ])("rejects malformed quotes or bare CR %j", (source) =>
    fails("syntax", () => parseCsv(source, { delimiter: "," })));

  it.each(["a,b\nc", "a\nb,c", "a,b\n\n", "a,b\nc,d,e"])("rejects ragged records %j", (source) =>
    fails("shape", () => parseCsv(source, { delimiter: "," })));

  it("rejects unsupported controls and runtime non-text without echoing data", () => {
    for (const source of ["private\0content", "\u0001", "\u000b", "\u000c", "\u001f", "\u007f"]) {
      fails("syntax", () => parseCsv(source));
      fails("syntax", () => serializeCsv([[source]]));
    }
    fails("invalid-input", () => parseCsv(42 as unknown as string));
    const error = new CsvError("syntax", "Invalid CSV");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Invalid CSV");
  });
});

describe("delimiter sniffing", () => {
  it.each([
    ["", ","],
    ["\n", ","],
    ["one column\nsecond", ","],
    ['"comma, semicolon; tab\t"\n', ","],
    ["name,email\nDana,dana@example.org", ","],
    ["\uFEFFname;email\r\nDana;dana@example.org", ";"],
    ["name\temail\nDana\tdana@example.org\n", "\t"],
    ['"name,quoted";email\n"Dana\nExample";dana@example.org', ";"],
    ["name;value\nDana;1,25\nRobin;2", ";"],
    ['a;"b"\nc;"d"', ";"],
    ['a\t"b"\nc\t"d"', "\t"],
  ] as const)("sniffs %j", (source, delimiter) => {
    expect(sniffDelimiter(source)).toBe(delimiter);
    expect(parseCsv(source)).toEqual(parseCsv(source, { delimiter }));
  });

  it.each([
    "a,b;c\nx,y;z",
    "a,b\tc\nx,y\tz",
    "a;b\tc\nx;y\tz",
  ])("rejects ambiguous input %j", (source) => {
    fails("delimiter", () => sniffDelimiter(source));
    fails("delimiter", () => parseCsv(source));
    expect(parseCsv(source, { delimiter: "," })).toHaveLength(2);
  });

  it("does not hide malformed syntax or ragged rows behind a one-column fallback", () => {
    for (const source of ['"unterminated', 'a,"unterminated', '"a"junk', "a\rb"]) {
      fails("syntax", () => sniffDelimiter(source));
    }
    // All three candidates fail shape, so the shape error survives sniffing.
    fails("shape", () => parseCsv("a,b;c\td\none"));
    expect(() => parseCsv("a,b\nc")).toThrow(CsvError);
    // Inspect every record, including errors beyond the first candidate's first line.
    fails("syntax", () => parseCsv('a;b\nc;"d"junk'));
    expect(parseCsv("a,b\nc", { delimiter: "\t" })).toEqual([["a,b"], ["c"]]);
  });

  it("requires a supported explicit delimiter", () => {
    for (const delimiter of ["|", "", "::", "\n", 42] as unknown as CsvDelimiter[]) {
      fails("delimiter", () => parseCsv("x", { delimiter }));
      fails("delimiter", () => serializeCsv([["x"]], { delimiter }));
    }
  });
});

describe("serialisation and round trips", () => {
  const rows = [
    ["name", "email", "notes", "empty"],
    ['Dana "Example"', "dana@example.org", "line 1\r\nline 2,;\t", ""],
    ["\uFEFFdata", "é🙂", "=SUM(A1:A2)", " "],
  ];

  it("writes canonical RFC 4180 records and retains blank rows", () => {
    expect(
      serializeCsv([
        ["a", "b"],
        ['a,"b"', ""],
      ]),
    ).toBe('a,b\r\n"a,""b""",\r\n');
    expect(serializeCsv([])).toBe("");
    expect(serializeCsv([[""], [""], ["x"]])).toBe("\r\n\r\nx\r\n");
    expect(parseCsv(serializeCsv([[""], [""]]))).toEqual([[""], [""]]);
    expect(serializeCsv([["\uFEFFdata"]])).toBe('"\uFEFFdata"\r\n');
    expect(serializeCsv([], { bom: true })).toBe("\uFEFF");
    for (const table of [[["a;b"]], [["a\tb"]], [["a;b", "c;d"]]]) {
      expect(parseCsv(serializeCsv(table))).toEqual(table);
    }
  });

  it.each([
    ",",
    ";",
    "\t",
  ] as const)("round trips %j with LF/CRLF and file/content BOMs", (delimiter) => {
    for (const lineEnding of ["\r\n", "\n"] as const) {
      for (const bom of [false, true]) {
        const output = serializeCsv(rows, { delimiter, lineEnding, bom });
        expect(output.startsWith("\uFEFF")).toBe(bom);
        expect(output.endsWith(lineEnding)).toBe(true);
        expect(parseCsv(output, { delimiter })).toEqual(rows);
        expect(inferColumnTypes(parseCsv(output, { delimiter }))).toEqual([
          "text",
          "text",
          "text",
          "text",
        ]);
      }
    }
  });

  it("round trips generated rectangular tables without changing source values", () => {
    const cell = fc
      .array(fc.constantFrom("a", "é", "🙂", " ", '"', ",", ";", "\t", "\r", "\n", "\uFEFF"), {
        maxLength: 20,
      })
      .map((characters) => characters.join(""));
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 8 })
          .chain((width) =>
            fc.array(fc.array(cell, { minLength: width, maxLength: width }), { maxLength: 12 }),
          ),
        fc.constantFrom<CsvDelimiter>(",", ";", "\t"),
        (table, delimiter) => {
          const snapshot = structuredClone(table);
          expect(parseCsv(serializeCsv(table, { delimiter }), { delimiter })).toEqual(snapshot);
          expect(parseCsv(serializeCsv(table, { delimiter }))).toEqual(snapshot);
          expect(table).toEqual(snapshot);
        },
      ),
      { seed: 4170, numRuns: 100 },
    );
  });

  it("rejects invalid serialisation options", () => {
    fails("invalid-input", () => serializeCsv([], { lineEnding: "\r" as "\n" }));
    fails("invalid-input", () => serializeCsv([], { bom: "yes" as unknown as boolean }));
  });
});

describe("locale-free column inference", () => {
  it.each([
    ["0", "number"],
    ["-0", "number"],
    ["-12.5", "number"],
    ["1E+3", "number"],
    ["1e-3", "number"],
    ["0e999", "number"],
    ["5e-324", "number"],
    ["9007199254740991", "number"],
    ["true", "boolean"],
    ["false", "boolean"],
    ["0001-01-01", "date"],
    ["2024-02-29", "date"],
    ["2000-02-29", "date"],
    ["2026-04-30", "date"],
    ["9999-12-31", "date"],
    ["01", "text"],
    ["-01", "text"],
    ["+1", "text"],
    [".5", "text"],
    ["1.", "text"],
    [" 1", "text"],
    ["1 ", "text"],
    ["1\n", "text"],
    ["1,5", "text"],
    ["1,000", "text"],
    ["0x10", "text"],
    ["NaN", "text"],
    ["Infinity", "text"],
    ["1e309", "text"],
    ["1e-400", "text"],
    ["-1e-400", "text"],
    ["9007199254740992", "text"],
    ["TRUE", "text"],
    ["False", "text"],
    ["yes", "text"],
    ["1/2/2026", "text"],
    ["2026-2-01", "text"],
    ["2026-01-01T00:00:00Z", "text"],
    ["0000-01-01", "text"],
    ["1900-02-29", "text"],
    ["2100-02-29", "text"],
    ["2025-02-29", "text"],
    ["2026-00-01", "text"],
    ["2026-13-01", "text"],
    ["2026-01-00", "text"],
    ["2026-01-32", "text"],
    ["2026-04-31", "text"],
    ["2026-01-01\n", "text"],
    ["=1+1", "text"],
    ["", "text"],
  ])("infers %j as %s", (value, type) => {
    expect(inferColumnTypes([[value]])).toEqual([type]);
  });

  it("uses every nonempty data cell, widens mixed columns and preserves the input", () => {
    const data = [
      ["", "1", "true", "2026-01-01", ""],
      ["", "2.5", "false", "2026-02-01", ""],
      ["", "", "", "", ""],
    ];
    const snapshot = structuredClone(data);
    expect(inferColumnTypes(data)).toEqual(["text", "number", "boolean", "date", "text"]);
    expect(data).toEqual(snapshot);
    expect(inferColumnTypes([])).toEqual([]);
    expect(
      inferColumnTypes([
        ["1", "true", "2026-01-01"],
        ["false", "1", "word"],
        ["2", "true", "2026-02-01"],
      ]),
    ).toEqual(["text", "text", "text"]);
    const imported = parseCsv(
      "name,amount,active,date\nDana,12.5,true,2026-01-01\nRobin,0,false,2024-02-29",
    );
    expect(inferColumnTypes(imported)).toEqual(["text", "text", "text", "text"]);
    expect(inferColumnTypes(imported.slice(1))).toEqual(["text", "number", "boolean", "date"]);
    expect(parseCsv(serializeCsv(imported))).toEqual(imported);
  });
});

describe("bounded input and table validation", () => {
  it("rejects unsupported table shapes for both export and inference", () => {
    for (const action of [serializeCsv, inferColumnTypes]) {
      fails("invalid-input", () => action(null as unknown as string[][]));
      fails("invalid-input", () => action([null] as unknown as string[][]));
      fails("invalid-input", () => action([[42]] as unknown as string[][]));
      fails("shape", () => action([[]]));
      fails("shape", () => action([["a"], ["b", "c"]]));
      fails("invalid-input", () => action(Array(1) as string[][]));
      fails("invalid-input", () => action([Array(1)] as string[][]));
    }
  });

  it("bounds raw input and sniffing, including the BOM", () => {
    const atLimit = "x".repeat(CSV_LIMITS.maxCodeUnits);
    expect(parseCsv(atLimit, { delimiter: "," })).toEqual([[atLimit]]);
    expect(sniffDelimiter(atLimit)).toBe(",");
    fails("limit", () => parseCsv(`\uFEFF${atLimit}`));
    fails("limit", () => sniffDelimiter(`${atLimit}x`));
    fails("limit", () => serializeCsv([[atLimit]])); // CRLF counts too
    fails("limit", () => serializeCsv([[`${atLimit}x`]]));
    expect(inferColumnTypes([[atLimit]])).toEqual(["text"]);
  });

  it("bounds aggregate text and encoded output, including doubled quotes and BOM", () => {
    const half = "x".repeat(CSV_LIMITS.maxCodeUnits / 2);
    for (const action of [serializeCsv, inferColumnTypes]) {
      fails("limit", () => action([[half, `${half}x`]]));
    }
    const exact = "x".repeat(CSV_LIMITS.maxCodeUnits - 2);
    expect(serializeCsv([[exact]]).length).toBe(CSV_LIMITS.maxCodeUnits);
    fails("limit", () => serializeCsv([[exact]], { bom: true }));
    fails("limit", () => serializeCsv([['"'.repeat(CSV_LIMITS.maxCodeUnits / 2)]]));
    expect(Object.isFrozen(CSV_LIMITS)).toBe(true);
  });

  it("bounds columns and cells in parsing, inference and export", () => {
    const row = Array<string>(CSV_LIMITS.maxColumns).fill("");
    expect(parseCsv(row.join(","), { delimiter: "," })[0]).toEqual(row);
    fails("limit", () => parseCsv(`${row.join(",")},`, { delimiter: "," }));
    const records = "x\n".repeat(CSV_LIMITS.maxRows);
    expect(parseCsv(records, { delimiter: "," })).toHaveLength(CSV_LIMITS.maxRows);
    fails("limit", () => parseCsv(`${records}x`, { delimiter: "," }));
    fails("limit", () => sniffDelimiter(`${records}x`));
    const rows = Array.from({ length: CSV_LIMITS.maxRows }, () => [""]);
    expect(inferColumnTypes(rows)).toEqual(["text"]);
    expect(serializeCsv(rows).length).toBe(2 * CSV_LIMITS.maxRows);
    for (const action of [serializeCsv, inferColumnTypes]) {
      fails("limit", () => action([...rows, [""]]));
      fails("limit", () => action([[...row, ""]]));
      fails("limit", () =>
        action(Array.from({ length: CSV_LIMITS.maxCells / 2 + 1 }, () => ["", ""])),
      );
    }
  });
});
