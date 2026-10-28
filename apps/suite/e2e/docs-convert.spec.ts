// AUTHORED-BY Codex
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { openArrayBuffer } from "mammoth/lib/zipfile.js";

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
}
async function downloadMenu(page: Page) {
  await page.getByRole("button", { name: "File menu", exact: true }).click();
  const trigger = page.getByRole("menuitem", { name: "Download", exact: true });
  // Keyboard opens the submenu reliably on touch and desktop project sizes.
  await trigger.focus();
  await trigger.press("ArrowRight");
}
async function upload(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto("/docs");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import document", exact: true });
  await expect(dialog).toBeVisible();
  await audit(page);
  await dialog.getByLabel("Document file", { exact: true }).setInputFiles(file);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
}
async function readDownload(page: Page, label: string) {
  await downloadMenu(page);
  const waiting = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  const download = await waiting;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

test("DOCX import keeps headings, lists, tables and an image and reports its footnote", async ({
  page,
}) => {
  await upload(page, fileURLToPath(new URL("./fixtures/docs-import.docx", import.meta.url)));
  const skipped = page.getByRole("dialog", { name: "Some items weren't imported", exact: true });
  await expect(skipped).toBeVisible();
  await expect(skipped).toContainText("Footnotes (1) weren't imported");
  await audit(page);
  await skipped.getByRole("button", { name: "Open document", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await expect(body.locator("h1")).toHaveText("Plan");
  await expect(body.locator("ul")).toContainText("Prepare launch");
  await expect(body.locator("table")).toContainText("Alice");
  await expect(body.getByRole("img", { name: "Fixture image", exact: true })).toBeVisible();
  await expect(body).not.toContainText("This footnote must be reported");
  await audit(page);
});

test("DOCX download contains the editor's heading, numbering, task, table and image relationship", async ({
  page,
}) => {
  await upload(page, fileURLToPath(new URL("./fixtures/docs-import.docx", import.meta.url)));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open document", exact: true })
    .click();
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.click();
  await body.press("Control+End");
  await body.press("Enter");
  const checklist = page
    .getByRole("toolbar", { name: "Formatting", exact: true })
    .getByRole("button", { name: "Checklist", exact: true });
  if (await checklist.isVisible()) await checklist.click();
  else {
    await page.getByRole("button", { name: "More formatting", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Checklist/ }).click();
  }
  await body.pressSequentially("Ready to export");
  await body.getByRole("checkbox", { name: "Ready to export", exact: true }).check();
  const result = await readDownload(page, "Microsoft Word (.docx)");
  expect(result.name).toBe("docs-import.docx");
  const zip = await openArrayBuffer(Uint8Array.from(result.bytes).buffer);
  const xml = await zip.read("word/document.xml", "utf-8");
  for (const value of ["<w:tbl>", 'w:val="Heading1"', "<w:numPr>", "☑", "r:embed="])
    expect(xml).toContain(value);
  expect(await zip.read("word/_rels/document.xml.rels", "utf-8")).toContain("relationships/image");
  await audit(page);
});

test("Markdown round trips structure and front matter and exports unsynced local edits offline", async ({
  page,
  context,
}) => {
  await upload(page, {
    name: "plan.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      '---\ntitle: "Launch plan"\n---\n# Plan\n\n- [x] Ready\n\n| Owner | Task |\n| --- | --- |\n| Alice | Review |\n\n**Bold** and ==highlighted==\n',
    ),
  });
  await expect(page.getByRole("textbox", { name: "Document title", exact: true })).toHaveValue(
    "Launch plan",
  );
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await expect(body.locator("h1")).toHaveText("Plan");
  await body.click();
  await body.press("Control+End");
  await body.press("Enter");
  await context.setOffline(true);
  await body.pressSequentially("Local unsynced words");
  const snapshot = await body.innerHTML();
  const result = await readDownload(page, "Markdown (.md)");
  const md = result.bytes.toString("utf-8");
  expect(md).toContain("# Plan");
  expect(md).toContain("- [x] Ready");
  expect(md).toContain("Local unsynced words");
  await context.setOffline(false);
  await page.getByRole("button", { name: "File menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import to replace…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import to replace document", exact: true });
  await audit(page);
  await dialog
    .getByLabel("Document file", { exact: true })
    .setInputFiles({ name: result.name, mimeType: "text/markdown", buffer: result.bytes });
  await dialog.getByRole("button", { name: "Replace contents", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(body).toHaveJSProperty("innerHTML", snapshot);
  await audit(page);
});

test("Print / Save as PDF offers help and the print stylesheet hides the shell", async ({
  page,
}) => {
  await page.goto("/docs/new");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Print this document");
  await downloadMenu(page);
  await expect(
    page.getByRole("menuitem", { name: "Print / Save as PDF", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose 'Save as PDF' in the print dialog", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ media: "print" });
  for (const selector of [
    ".ish-rail",
    ".ish-sidebar",
    ".ish-topbar",
    ".ish-tabbar",
    ".docs-toolbar",
  ])
    await expect(page.locator(selector).first()).toBeHidden();
  const article = page.getByRole("article", { name: "Document page", exact: true });
  await expect(article).toHaveCSS("max-width", "none");
  const widths = await article.evaluate((element) => ({
    page: element.getBoundingClientRect().width,
    parent: element.parentElement?.getBoundingClientRect().width,
  }));
  expect(widths.page).toBeCloseTo(widths.parent ?? 0, 0);
  await page.emulateMedia({ media: "screen" });
  await audit(page);
});
