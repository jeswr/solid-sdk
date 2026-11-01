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
          ],
        }),
      ),
    ).toBe(
      "<p>See</p>" +
        '<p><a href="https://example.org/a?b=1&amp;c=2">Plan &lt;one&gt;</a></p>' +
        '<p><a href="https://example.org/b">https://example.org/b</a></p>' +
        "<p>https://user:secret@example.org/c</p>",
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
    const existing = { title: "Old", body: "<p>Kept</p>" };
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
        }),
        file("Keep/Old.JSON", { title: "Old", textContent: "Kept" }),
        file("Keep/Plain.json", { title: "Plain", textContent: "Hello" }),
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
    ]);
    expect(plan.skipped).toEqual([
      { fileName: "Keep/Shopping copy.json", reason: KEEP_SKIP_REASONS.duplicate },
      { fileName: "Keep/Old.JSON", reason: KEEP_SKIP_REASONS.duplicate },
      { fileName: "Keep/Broken.json", reason: KEEP_SKIP_REASONS.INVALID_KEEP_NOTE },
    ]);
    expect(plan).toMatchObject({ trashed: 1, ignored: 2, attachments: 1, adjusted: 1 });
    expect(keepFingerprint({ title: " Old ", body: "<p>Kept</p>" })).toBe(
      keepFingerprint(existing),
    );
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
