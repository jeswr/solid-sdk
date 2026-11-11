// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  KEEP_SKIP_REASONS,
  type KeepNoteDraft,
  keepBodyHtml,
  keepDraftToNote,
  keepFingerprint,
  MAX_KEEP_BATCH_FILES,
  planKeepImport,
} from "../src/apps/notes/lib/keep";

const draft = (overrides: Partial<KeepNoteDraft> = {}): KeepNoteDraft => ({
  title: "",
  body: { kind: "text", text: "" },
  labels: [],
  pinned: false,
  archived: false,
  trashed: false,
  colour: "DEFAULT",
  links: [],
  attachments: [],
  ...overrides,
});
const file = (fileName: string, note: Record<string, unknown>) => ({
  fileName,
  json: JSON.stringify(note),
});

describe("Keep note bodies", () => {
  it("keeps paragraphs and inner blank lines, trims outer blank lines and escapes text", () => {
    expect(
      keepBodyHtml(
        draft({ body: { kind: "text", text: "\n \nPlant <beans>\r\n\r\nWater & feed\n\n" } }),
      ),
    ).toBe("<p>Plant &lt;beans&gt;</p><p></p><p>Water &amp; feed</p>");
    expect(keepBodyHtml(draft())).toBe("");
  });
  it("renders checklists as task lists without empty items", () => {
    const html = keepBodyHtml(
      draft({
        body: {
          kind: "checklist",
          items: [
            { text: "Milk", checked: true },
            { text: "  ", checked: false },
            { text: "Eggs", checked: false },
          ],
        },
      }),
    );
    expect(html).toContain('data-checked="true"');
    expect(html.match(/data-type="taskItem"/g)).toHaveLength(2);
    expect(html).toContain("<p>Eggs</p>");
  });
  it("appends safe links as anchors and other links as text", () => {
    expect(
      keepBodyHtml(
        draft({
          body: { kind: "text", text: "See" },
          links: [
            { url: "https://example.org/a?b=1&c=2", title: "Plan <one>" },
            { url: "https://example.org/b", title: "  " },
            { url: "https://user:secret@example.org/c" },
            { url: "not a url" },
          ],
        }),
      ),
    ).toBe(
      "<p>See</p>" +
        '<p><a href="https://example.org/a?b=1&amp;c=2">Plan &lt;one&gt;</a></p>' +
        '<p><a href="https://example.org/b">https://example.org/b</a></p>' +
        '<p><a href="https://example.org/c">https://example.org/c</a></p>' +
        "<p>not a url</p>",
    );
  });
});

describe("Keep drafts to notes", () => {
  it("maps title, labels, pin, archive and every Keep colour", () => {
    const item = keepDraftToNote(
      "a.json",
      draft({
        title: "  Garden  ",
        labels: [" Ideas ", "", "Ideas", "Home"],
        pinned: true,
        archived: true,
        trashed: true,
        colour: "CERULEAN",
      }),
    );
    expect(item).toMatchObject({
      fileName: "a.json",
      input: { title: "Garden", body: "", labels: ["Ideas", "Home"] },
      pinned: true,
      archived: true,
      trashed: true,
      colour: "blue",
    });
    expect(keepDraftToNote("b.json", draft({ colour: "GRAY" })).colour).toBe("grey");
    expect(keepDraftToNote("c.json", draft({ colour: "TEAL" })).colour).toBe("teal");
  });
  it("shortens titles over the 200-character limit", () => {
    const title = keepDraftToNote("d.json", draft({ title: "word ".repeat(60) })).input.title;
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("Keep import plans", () => {
  it("imports good notes and reports trashed, duplicate, invalid and other files", () => {
    const existing = { title: "Old", body: "<p>Kept</p>", labels: [] };
    const plan = planKeepImport(
      [
        file("Keep/Shopping.json", {
          title: "Shopping",
          listContent: [{ text: "Milk", isChecked: false }],
          color: "MAUVE",
          attachments: [{ filePath: "photo.jpg", mimetype: "image/jpeg" }],
        }),
        file("Keep/Shopping copy.json", {
          title: "Shopping",
          listContent: [{ text: "Milk", isChecked: false }],
          attachments: [{ filePath: "photo.jpg", mimetype: "image/jpeg" }],
        }),
        file("Keep/Old.JSON", { title: "Old", textContent: "Kept" }),
        file("Keep/Plain.json", { title: "Plain", textContent: "Hello" }),
        file("Keep/Plain work.json", {
          title: "Plain",
          textContent: "Hello",
          labels: [{ name: "Work" }],
        }),
        file("Keep/Both.json", {
          title: "Both",
          textContent: "Displaced <text>",
          listContent: [{ text: "Item", isChecked: false }],
        }),
        file("Keep/Blank.json", { title: " ", textContent: "\n" }),
        file("Keep/Photo.json", {
          attachments: [{ filePath: "b.jpg", mimetype: "image/jpeg" }],
        }),
        file("Keep/Binned.json", { title: "Binned", textContent: "x", isTrashed: true }),
        { fileName: "Keep/Broken.json", json: "{" },
        { fileName: "Keep/Shopping.html", json: "<html>" },
        { fileName: "Keep/photo.jpg", json: "" },
      ],
      [existing],
    );
    expect(plan.ready.map((item) => item.fileName)).toEqual([
      "Keep/Shopping.json",
      "Keep/Plain.json",
      "Keep/Plain work.json",
      "Keep/Both.json",
    ]);
    expect(plan.ready[3]?.input.body).toMatch(/<\/ul><p>Displaced &lt;text&gt;<\/p>$/);
    expect(plan.skipped).toEqual([
      { fileName: "Keep/Shopping copy.json", reason: KEEP_SKIP_REASONS.duplicate },
      { fileName: "Keep/Old.JSON", reason: KEEP_SKIP_REASONS.duplicate },
      { fileName: "Keep/Blank.json", reason: KEEP_SKIP_REASONS.empty },
      { fileName: "Keep/Photo.json", reason: KEEP_SKIP_REASONS.attachmentsOnly },
      { fileName: "Keep/Broken.json", reason: KEEP_SKIP_REASONS.INVALID_KEEP_NOTE },
    ]);
    expect(plan).toMatchObject({ trashed: 1, ignored: 2, attachments: 1, adjusted: 1 });
    expect(keepFingerprint({ title: " Old ", body: "<p>Kept</p>", labels: [] })).toBe(
      keepFingerprint(existing),
    );
    expect(keepFingerprint({ title: "T", body: "", labels: ["b", "a"] })).toBe(
      keepFingerprint({ title: "T", body: "", labels: ["a", "b"] }),
    );
  });
  it("keeps notes with different attachments while skipping identical batch copies", () => {
    const note = (filePath?: string) => ({
      title: "Birds",
      textContent: "In the garden",
      labels: [{ name: "Home" }],
      ...(filePath && { attachments: [{ filePath, mimetype: "image/png" }] }),
    });
    const first = new File(["pixels"], "first.png", { type: "image/png" });
    const second = new File(["pixels"], "second.png", { type: "image/png" });
    const plan = planKeepImport(
      [
        file("Keep/First.json", note("first.png")),
        file("Keep/Second.json", note("second.png")),
        file("Keep/First copy.json", note("./first.png")),
        file("Keep/Other/First.json", note("first.png")),
        file("Keep/Text.json", note()),
        file("Keep/Missing.json", note("missing.png")),
      ],
      [],
      new Map([
        ["Keep/first.png", first],
        ["Keep/second.png", second],
        ["Keep/Other/first.png", first],
      ]),
    );
    expect(plan.ready.map((item) => item.fileName)).toEqual([
      "Keep/First.json",
      "Keep/Second.json",
      "Keep/Other/First.json",
      "Keep/Text.json",
      "Keep/Missing.json",
    ]);
    expect(plan.ready.map((item) => item.images?.length ?? 0)).toEqual([1, 1, 1, 0, 0]);
    expect(plan.skipped).toEqual([
      { fileName: "Keep/First copy.json", reason: KEEP_SKIP_REASONS.duplicate },
    ]);
    expect(plan.attachments).toBe(1);
  });
  it("reports existing Notes as duplicates even when the selection has different images", () => {
    const files = [
      file("Keep/Birds.json", {
        title: "Birds",
        textContent: "In the garden",
        labels: [{ name: "Home" }],
        attachments: [{ filePath: "new.png", mimetype: "image/png" }],
      }),
    ];
    const media = new Map([
      ["Keep/new.png", new File(["pixels"], "new.png", { type: "image/png" })],
    ]);
    for (const body of [
      "<p>In the garden</p>",
      '<p>In the garden</p><img src="https://pod.example/notes/media/old.png" alt="Bird">',
    ]) {
      const plan = planKeepImport(files, [{ title: "Birds", body, labels: ["Home"] }], media);
      expect(plan.ready).toEqual([]);
      expect(plan.skipped).toEqual([{ fileName: "Keep/Birds.json", reason: "Already in Notes" }]);
    }
  });
  it("names files whose names could not be read by position", () => {
    const plan = planKeepImport([{ fileName: `${"x".repeat(2000)}.json`, json: "{}" }], []);
    expect(plan.skipped).toEqual([
      { fileName: "File 1", reason: KEEP_SKIP_REASONS.INVALID_KEEP_NOTE },
    ]);
  });
  it("refuses selections over the batch limit before parsing", () => {
    const files = Array.from({ length: MAX_KEEP_BATCH_FILES + 1 }, (_, index) => ({
      fileName: `${index}.json`,
      json: "{",
    }));
    const plan = planKeepImport([...files, { fileName: "a.png", json: "" }], []);
    expect(plan).toEqual({
      ready: [],
      skipped: [
        {
          fileName: `${MAX_KEEP_BATCH_FILES + 1} files`,
          reason: KEEP_SKIP_REASONS.BATCH_TOO_LARGE,
        },
      ],
      trashed: 0,
      ignored: 1,
      attachments: 0,
      adjusted: 0,
    });
  });
});
