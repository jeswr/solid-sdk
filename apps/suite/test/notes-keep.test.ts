// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  KEEP_COLOURS,
  KeepImportError,
  type KeepImportErrorCode,
  type KeepNoteFile,
  MAX_KEEP_BATCH_FILES,
  MAX_KEEP_LABELS,
  MAX_KEEP_LIST_ITEMS,
  MAX_KEEP_NOTE_BYTES,
  parseKeepBatch,
  parseKeepNote,
} from "../src/apps/notes/lib/keep";

const parse = (note: unknown) => parseKeepNote(JSON.stringify(note));
function fails(operation: () => unknown, code: KeepImportErrorCode): void {
  expect(operation).toThrow(KeepImportError);
  expect(operation).toThrow(expect.objectContaining({ name: "KeepImportError", code }));
}

describe("Keep note drafts", () => {
  it("copies synthetic plain text, flags, labels, dates, links and attachment references", () => {
    const input = {
      title: "Rowan's garden plan",
      textContent: "Plant beans\nMeet Morgan <b>outside</b> 🪴",
      textContentHtml: '<script>throw new Error("never render")</script>',
      labels: [{ name: " Garden " }, { name: "GARDEN" }, { name: "Ideas" }, { name: " ideas " }],
      isPinned: true,
      isArchived: true,
      isTrashed: true,
      color: "TEAL",
      createdTimestampUsec: "1704067200123456",
      userEditedTimestampUsec: 1704153600987654,
      annotations: [
        {
          url: "https://example.org/garden?q=beans#plan",
          title: "Garden plan",
          description: "A fictional planting guide",
          source: "WEBLINK",
        },
      ],
      attachments: [{ filePath: "attachments/garden.jpg", mimetype: "image/jpeg" }],
    };
    const original = JSON.stringify(input);
    expect(parse(input)).toEqual({
      draft: {
        title: input.title,
        body: { kind: "text", text: input.textContent },
        labels: ["Garden", "Ideas"],
        pinned: true,
        archived: true,
        trashed: true,
        colour: "TEAL",
        created: "2024-01-01T00:00:00.123Z",
        updated: "2024-01-02T00:00:00.987Z",
        links: input.annotations,
        attachments: input.attachments,
      },
      warnings: [],
    });
    expect(JSON.stringify(input)).toBe(original);
  });

  it("defaults omitted fields without inventing dates or falling back to HTML", () => {
    const empty = {
      draft: {
        title: "",
        body: { kind: "text", text: "" },
        labels: [],
        pinned: false,
        archived: false,
        trashed: false,
        colour: "DEFAULT",
        links: [],
        attachments: [],
      },
      warnings: [],
    };
    expect(parse({})).toEqual(empty);
    expect(parse({ textContentHtml: "<p>HTML only</p>" })).toEqual(empty);
    expect(parse({ isPinned: false, isArchived: false, isTrashed: false })).toEqual(empty);
  });

  it("keeps ordered checklist text and checked flags; lists win and preserve displaced text", () => {
    expect(
      parse({
        textContent: "Original plain text\n<script>still plain</script>",
        listContent: [
          { text: " Buy seeds ", isChecked: false },
          { text: "", isChecked: true },
        ],
      }),
    ).toMatchObject({
      draft: {
        body: {
          kind: "checklist",
          items: [
            { text: " Buy seeds ", checked: false },
            { text: "", checked: true },
          ],
        },
      },
      warnings: [
        {
          code: "TEXT_CONTENT_IGNORED",
          textContent: "Original plain text\n<script>still plain</script>",
        },
      ],
    });
    expect(parse({ listContent: [] }).draft.body).toEqual({ kind: "checklist", items: [] });
    expect(parse({ listContent: [], textContent: "" }).warnings).toEqual([
      { code: "TEXT_CONTENT_IGNORED", textContent: "" },
    ]);
  });

  it("trims and folds labels without changing the first spelling or their order", () => {
    expect(
      parse({
        labels: [" École ", "éCOLE", "Work", "work", "  ", "", "旅行"].map((name) => ({ name })),
      }).draft.labels,
    ).toEqual(["École", "Work", "", "旅行"]);
  });

  it.each(KEEP_COLOURS)("maps the %s Keep enum to its colour name", (color) => {
    expect(parse({ color })).toMatchObject({ draft: { colour: color }, warnings: [] });
  });

  it.each(["FUTURE_COLOR", "red", "", "__proto__"])("warns for unknown colour %s", (color) => {
    expect(parse({ color })).toMatchObject({
      draft: { colour: "DEFAULT" },
      warnings: [{ code: "UNKNOWN_COLOR", color }],
    });
  });

  it("retains http(s) link spellings and optional metadata", () => {
    const annotations = [
      { url: "http://example.org" },
      { url: "HTTPS://EXAMPLE.ORG:443/path", title: "", description: "", source: "" },
    ];
    expect(parse({ annotations })).toMatchObject({ draft: { links: annotations }, warnings: [] });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>bad</script>",
    "file:///etc/passwd",
    "mailto:rowan@example.org",
    "ftp://example.org",
    "//example.org/path",
    "/relative",
    "",
    "https://",
    "https://[invalid]",
    "https://example.org:99999",
    " https://example.org",
    "https://example.org/has space",
    "https://example.org/\tpath",
    "https://example.org/\u007fpath",
    "https:\\example.org",
  ])("drops unsafe or invalid annotation %j with a warning", (url) => {
    expect(parse({ annotations: [{ url }] })).toMatchObject({
      draft: { links: [] },
      warnings: [{ code: "UNSAFE_ANNOTATION_URL", url }],
    });
  });

  it.each([
    "image.png",
    "nested/image.png",
    "nested\\image.png",
    "./image.png",
    "a..b.png",
  ])("preserves safe relative attachment %s", (filePath) => {
    const attachments = [{ filePath, mimetype: "image/png" }];
    expect(parse({ attachments }).draft.attachments).toEqual(attachments);
  });

  it.each([
    "",
    "/image.png",
    "\\image.png",
    "//example.org/image.png",
    "\\\\server\\image.png",
    "C:\\image.png",
    "C:/image.png",
    "C:image.png",
    "file:image.png",
    "https://example.org/image.png",
    "..",
    "../image.png",
    "a/../image.png",
    "a\\..\\image.png",
    "a/..\\image.png",
    "a/..",
    "a\u0000.png",
  ])("rejects unsafe attachment %j", (filePath) => {
    fails(
      () => parse({ attachments: [{ filePath, mimetype: "image/png" }] }),
      "UNSAFE_ATTACHMENT_PATH",
    );
  });
});

describe("Keep timestamp precision", () => {
  it.each([
    ["0", "1970-01-01T00:00:00.000Z"],
    ["-0", "1970-01-01T00:00:00.000Z"],
    ["999", "1970-01-01T00:00:00.000Z"],
    ["-999", "1970-01-01T00:00:00.000Z"],
    ["-1001", "1969-12-31T23:59:59.999Z"],
    ["9007199254740999", "2255-06-05T23:47:34.740Z"],
    ["8640000000000000000", "+275760-09-13T00:00:00.000Z"],
    ["-8640000000000000000", "-271821-04-20T00:00:00.000Z"],
  ])("converts exact numeric and string microseconds %s", (value, iso) => {
    expect(parseKeepNote(`{"createdTimestampUsec":${value}}`).draft.created).toBe(iso);
    expect(parse({ userEditedTimestampUsec: value }).draft.updated).toBe(iso);
  });

  it("recognizes escaped timestamp keys without rewriting text or metadata numbers", () => {
    expect(
      parseKeepNote(
        '{"createdTimestampUse\\u0063" \n: \t9007199254740999,"textContent":"\\"createdTimestampUsec\\":123"}',
      ).draft,
    ).toMatchObject({
      created: "2255-06-05T23:47:34.740Z",
      body: { kind: "text", text: '"createdTimestampUsec":123' },
    });
    fails(() => parseKeepNote('{"title":12,"isPinned":0}'), "INVALID_KEEP_NOTE");
  });

  it.each([
    "8640000000000000001",
    "-8640000000000000001",
    "9".repeat(1000),
  ])("rejects exact out-of-Date-range numeric/string timestamps %s", (value) => {
    fails(() => parseKeepNote(`{"createdTimestampUsec":${value}}`), "INVALID_TIMESTAMP");
    fails(() => parse({ userEditedTimestampUsec: value }), "INVALID_TIMESTAMP");
  });

  it.each(["1.5", "1e3", "1E+3", "-1e-3"])("rejects noninteger token spelling %s", (value) => {
    fails(() => parseKeepNote(`{"createdTimestampUsec":${value}}`), "INVALID_TIMESTAMP");
  });
  it.each([
    "",
    " ",
    " 1",
    "1\n",
    "1\r",
    "1\u2028",
    "+1",
    "1.0",
    "1e3",
    "NaN",
    "Infinity",
    "2024-01-01",
    "--1",
  ])("rejects malformed timestamp string %j", (createdTimestampUsec) =>
    fails(() => parse({ createdTimestampUsec }), "INVALID_TIMESTAMP"));
});

describe("Keep input validation and limits", () => {
  it.each([
    "",
    "{",
    '{"title":"bad\\q"}',
    '{"title":"raw\nnewline"}',
    '{"title":"x",}',
    '{"createdTimestampUsec":01}',
    '{"createdTimestampUsec":+1}',
    '{"createdTimestampUsec":1.}',
    '{"createdTimestampUsec":1e}',
    '{"createdTimestampUsec":NaN}',
    "null",
    "[]",
    '"text"',
    "true",
    "42",
  ])("rejects malformed or nonobject JSON %j", (json) => {
    fails(() => parseKeepNote(json), "INVALID_KEEP_NOTE");
  });
  it("rejects a non-string serialized input with a typed error", () => {
    fails(() => parseKeepNote(null as unknown as string), "INVALID_KEEP_NOTE");
  });

  it.each([
    { title: 12 },
    { title: "\ud800" },
    { textContent: null },
    { textContentHtml: {} },
    { textContentHtml: "\udfff" },
    { textContent: false, listContent: [] },
    { isPinned: 1 },
    { isArchived: "false" },
    { isTrashed: null },
    { color: 12 },
    { listContent: {} },
    { listContent: [null] },
    { listContent: [[]] },
    { listContent: [{ text: "item", isChecked: "true" }] },
    { listContent: [{ text: 1, isChecked: false }] },
    { listContent: [{ text: "item" }] },
    { listContent: [{ isChecked: true }] },
    { listContent: [{ text: "item", isChecked: false, extra: 1 }] },
    { labels: "label" },
    { labels: [null] },
    { labels: ["label"] },
    { labels: [{}] },
    { labels: [{ name: 3 }] },
    { labels: [{ name: "label", extra: true }] },
    { createdTimestampUsec: null },
    { createdTimestampUsec: false },
    { userEditedTimestampUsec: [] },
    { annotations: null },
    { annotations: [null] },
    { annotations: [{}] },
    { annotations: [{ url: 3 }] },
    { annotations: [{ url: "javascript:bad", title: false }] },
    { annotations: [{ url: "https://example.org", description: null }] },
    { annotations: [{ url: "https://example.org", source: {} }] },
    { annotations: [{ url: "https://example.org", extra: "unsupported" }] },
    { attachments: false },
    { attachments: [null] },
    { attachments: [{}] },
    { attachments: [{ filePath: 3, mimetype: "image/png" }] },
    { attachments: [{ filePath: "a.png", mimetype: null }] },
    { attachments: [{ filePath: "a.png", mimetype: "image/png", extra: true }] },
    { reminder: { unsupported: true } },
  ])("rejects unsupported fields or wrong field types: %j", (note) => {
    fails(() => parse(note), "INVALID_KEEP_NOTE");
  });

  it("accepts exactly 1 MiB and rejects 1 MiB + 1 before JSON parsing", () => {
    expect(MAX_KEEP_NOTE_BYTES).toBe(1_048_576);
    const json = JSON.stringify({ title: "a".repeat(MAX_KEEP_NOTE_BYTES - 12) });
    expect(new TextEncoder().encode(json)).toHaveLength(MAX_KEEP_NOTE_BYTES);
    expect(parseKeepNote(json).draft.title).toHaveLength(MAX_KEEP_NOTE_BYTES - 12);
    fails(() => parseKeepNote(`${json} `), "NOTE_TOO_LARGE");
    fails(() => parseKeepNote("{".repeat(MAX_KEEP_NOTE_BYTES + 1)), "NOTE_TOO_LARGE");
  });

  it.each(["é", "界", "🪴"])("counts UTF-8 bytes at the boundary with %s", (character) => {
    const width = new TextEncoder().encode(character).length;
    const count = Math.floor((MAX_KEEP_NOTE_BYTES - 12) / width);
    const padding = MAX_KEEP_NOTE_BYTES - 12 - count * width;
    const json = JSON.stringify({ title: character.repeat(count) + "a".repeat(padding) });
    expect(new TextEncoder().encode(json)).toHaveLength(MAX_KEEP_NOTE_BYTES);
    expect(parseKeepNote(json).draft.title).toBe(character.repeat(count) + "a".repeat(padding));
    fails(() => parseKeepNote(`${json} `), "NOTE_TOO_LARGE");
  });

  it("checks raw list and label lengths at the bound and bound + 1", () => {
    expect(MAX_KEEP_LIST_ITEMS).toBe(2_000);
    expect(MAX_KEEP_LABELS).toBe(200);
    const listContent = Array.from({ length: MAX_KEEP_LIST_ITEMS }, (_, i) => ({
      text: `Item ${i}`,
      isChecked: i % 2 === 0,
    }));
    const labels = Array.from({ length: MAX_KEEP_LABELS }, (_, i) => ({ name: `Label ${i}` }));
    expect(parse({ listContent, labels }).draft).toMatchObject({
      body: {
        kind: "checklist",
        items: listContent.map(({ text, isChecked }) => ({ text, checked: isChecked })),
      },
      labels: labels.map(({ name }) => name),
    });
    fails(() => parse({ listContent: [...listContent, listContent[0]] }), "INVALID_KEEP_NOTE");
    fails(() => parse({ labels: [...labels, labels[0]] }), "INVALID_KEEP_NOTE");
    fails(
      () => parse({ labels: Array(MAX_KEEP_LABELS + 1).fill({ name: "same" }) }),
      "INVALID_KEEP_NOTE",
    );
  });

  it("keeps private content out of thrown diagnostics", () => {
    const result = parseKeepBatch([{ fileName: "fictional.json", json: '{"private Rowan text' }]);
    expect(result[0]).toMatchObject({
      ok: false,
      error: { message: "Keep import: INVALID_KEEP_NOTE" },
    });
  });
});

describe("Keep batches", () => {
  it("isolates every error code between successful files, retaining input order and duplicate names", () => {
    const files = [
      { fileName: "note.json", json: '{"title":"First"}' },
      { fileName: "broken.json", json: "{" },
      { fileName: "large.json", json: " ".repeat(MAX_KEEP_NOTE_BYTES + 1) },
      { fileName: "date.json", json: '{"createdTimestampUsec":"invalid"}' },
      {
        fileName: "path.json",
        json: '{"attachments":[{"filePath":"../x","mimetype":"image/png"}]}',
      },
      { fileName: "note.json", json: '{"title":"Last","color":"UNKNOWN"}' },
    ];
    const results = parseKeepBatch(files);
    expect(results.map(({ index, fileName, ok }) => ({ index, fileName, ok }))).toEqual(
      files.map(({ fileName }, index) => ({ index, fileName, ok: index === 0 || index === 5 })),
    );
    expect(results.slice(1, 5).map((result) => !result.ok && result.error.code)).toEqual([
      "INVALID_KEEP_NOTE",
      "NOTE_TOO_LARGE",
      "INVALID_TIMESTAMP",
      "UNSAFE_ATTACHMENT_PATH",
    ]);
    expect(results[0]).toMatchObject({ draft: { title: "First" } });
    expect(results[5]).toMatchObject({
      draft: { title: "Last" },
      warnings: [{ code: "UNKNOWN_COLOR" }],
    });
  });

  it("accepts no files and exactly 10,000 files; rejects 10,001 before reading entries", () => {
    expect(MAX_KEEP_BATCH_FILES).toBe(10_000);
    expect(parseKeepBatch([])).toEqual([]);
    const files = Array.from({ length: MAX_KEEP_BATCH_FILES }, () => ({
      fileName: "note.json",
      json: "{}",
    }));
    expect(parseKeepBatch(files)).toHaveLength(MAX_KEEP_BATCH_FILES);
    const tooMany = new Array(MAX_KEEP_BATCH_FILES + 1);
    Object.defineProperty(tooMany, 0, {
      get: () => {
        throw new Error("must not read");
      },
    });
    fails(() => parseKeepBatch(tooMany), "BATCH_TOO_LARGE");
    fails(() => parseKeepBatch(null as unknown as KeepNoteFile[]), "INVALID_KEEP_NOTE");
  });

  it("returns per-file errors for malformed descriptors, holes and unexpected getter failures", () => {
    const files: unknown[] = [
      null,
      {},
      { fileName: 1, json: "{}" },
      { fileName: "bad-json.json", json: 1 },
      { fileName: "extra.json", json: "{}", extra: true },
      {
        get fileName() {
          throw new Error("private diagnostic");
        },
      },
    ];
    files.length += 1;
    const results = parseKeepBatch(files as KeepNoteFile[]);
    expect(results).toHaveLength(7);
    for (const result of results)
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_KEEP_NOTE" } });
    expect(results[0]).not.toHaveProperty("fileName");
    expect(results[3]).toMatchObject({ fileName: "bad-json.json" });
    expect(results[5]).toMatchObject({ error: { message: "Keep import: INVALID_KEEP_NOTE" } });
  });
});
