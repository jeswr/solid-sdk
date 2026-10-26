// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** The component's alert, not Next's always-present route announcer (also role="alert"). */
function appAlert(page: Page) {
  return page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));
}
const directory = fileURLToPath(new URL("../../../artifacts/screens/DS-11/", import.meta.url));
const errors = [
  "reauth",
  "forbidden",
  "not-found",
  "conflict",
  "name-taken",
  "quota",
  "too-large",
  "offline",
  "unreachable",
  "unsupported",
  "unknown",
];
const states = [
  "ready",
  "loading",
  "empty",
  "filtered-empty",
  ...errors.map((error) => `error-${error}`),
];
async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
async function screenshot(page: Page, name: string, project: string) {
  const viewport = page.viewportSize();
  await page.evaluate(() => document.fonts.ready);
  await accessible(page);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${project}.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await accessible(page);
  if (viewport) await page.setViewportSize(viewport);
}
for (const component of ["upload-dock", "drop-zone-overlay", "preview-pane"]) {
  const extra =
    component === "upload-dock"
      ? [
          "collapsed",
          "no-pause",
          "fixed",
          "queued",
          "uploading",
          "paused",
          "waiting",
          "done",
          "failed",
          "skipped",
        ]
      : component === "drop-zone-overlay"
        ? ["drag-over", "disabled"]
        : [];
  for (const state of [...states, ...extra]) {
    test(`${component}: ${state}`, async ({ page }, info) => {
      await page.goto(`/dev/components/${component}?state=${state}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (component === "preview-pane" && state === "ready")
        await expect(page.getByRole("img")).toBeVisible();
      if (state === "fixed")
        await page.getByRole("button", { name: "Show bottom-right dock" }).click();
      await screenshot(page, `${component}-${state}`, info.project.name);
    });
  }
}
for (const kind of ["image", "pdf", "video", "audio", "text", "markdown", "typed", "unknown"]) {
  test(`preview fixture: ${kind}`, async ({ page }, info) => {
    await page.goto(`/dev/components/preview-pane?kind=${kind}`);
    await expect(page.getByRole("link", { name: /^Download / })).toBeVisible();
    if (kind === "video" || kind === "audio") {
      const media = page.locator(kind);
      await expect
        .poll(() => media.evaluate((el) => (el as HTMLMediaElement).readyState))
        .toBeGreaterThanOrEqual(1);
      await expect(media).toHaveJSProperty("paused", true);
    }
    if (kind === "pdf")
      await expect(page.getByTitle(/^PDF preview:/)).toHaveAttribute("src", /^blob:/);
    if (kind === "text") await expect(page.getByRole("button", { name: "Show raw" })).toBeVisible();
    if (kind === "markdown")
      await expect(page.getByRole("heading", { name: "Meeting notes", exact: true })).toBeVisible();
    await screenshot(page, `preview-${kind}`, info.project.name);
  });
}
test("keyboard upload queue, image zoom/pan, and rendered/raw preview", async ({ page }, info) => {
  await page.goto("/dev/components/upload-dock");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "All components" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Uploads.*Collapse/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Pause Project proposal.pdf" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Resume Project proposal.pdf" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /7 uploads.*Expand/ })).toBeFocused();
  await screenshot(page, "dock-keyboard-collapsed", info.project.name);
  await page.keyboard.press("Enter");
  await accessible(page);
  await page.goto("/dev/components/preview-pane?kind=image");
  const viewport = page.getByRole("region", { name: /^Image preview:/ });
  await viewport.focus();
  await page.keyboard.press("+");
  await expect(page.getByText("125%")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  expect(await viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await screenshot(page, "preview-image-zoom", info.project.name);
  await page.goto("/dev/components/preview-pane?kind=markdown");
  await page.getByRole("button", { name: "Show raw" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("pre")).toContainText("**yours**");
  await screenshot(page, "preview-markdown-raw", info.project.name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Meeting notes", exact: true })).toBeVisible();
});
test("native drag-drop of two files plus a folder with nested and empty entries", async ({
  page,
}, info) => {
  await page.goto("/dev/components/drop-zone-overlay");
  // DataTransferItem entry APIs are browser-owned and not writable on synthetic File items.
  // A native DataTransfer carries the two files; the folder item supplies the browser entry contract.
  await page.evaluate(() => {
    const file = (name: string) => new File([name], name, { type: "text/plain" });
    const entry = (name: string) => ({
      name,
      isFile: true,
      isDirectory: false,
      file: (ok: (value: File) => void) => ok(file(name)),
    });
    const folder = (name: string, batches: unknown[][]) => ({
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let index = 0;
        return { readEntries: (ok: (value: unknown[]) => void) => ok(batches[index++] ?? []) };
      },
    });
    const transfer = new DataTransfer();
    transfer.items.add(file("one.txt"));
    transfer.items.add(file("two.txt"));
    const items = [...transfer.items].map((item) => ({
      kind: "file",
      webkitGetAsEntry: () => null,
      getAsFile: () => item.getAsFile(),
    }));
    const project = folder("Project", [
      [entry("notes.md")],
      [folder("Empty", []), folder("Nested", [[entry("photo.txt")]])],
    ]);
    items.push({ kind: "file", webkitGetAsEntry: () => project as never, getAsFile: () => null });
    Object.defineProperty(transfer, "items", { value: items });
    const zone = document.querySelector(".su-drop-zone");
    zone?.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    zone?.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    zone?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await expect(page.getByRole("heading", { name: "4 files received" })).toBeVisible();
  for (const path of [
    "one.txt",
    "two.txt",
    "Project/",
    "Project/Empty/",
    "Project/Nested/",
    "Project/notes.md",
    "Project/Nested/photo.txt",
  ])
    await expect(page.getByText(path, { exact: true })).toBeVisible();
  await expect(page.locator(".su-drop-overlay")).toBeHidden();
  await screenshot(page, "drop-files-and-folder", info.project.name);
});
test("file and folder pickers provide a keyboard upload alternative", async ({ page }, info) => {
  await page.goto("/dev/components/drop-zone-overlay");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([
    { name: "keyboard.txt", mimeType: "text/plain", buffer: Buffer.from("Saved to your pod") },
  ]);
  await expect(page.getByRole("heading", { name: "1 file received" })).toBeVisible();
  await screenshot(page, "drop-keyboard-picker", info.project.name);
  const folderPath = info.outputPath("Project");
  await mkdir(join(folderPath, "Nested"), { recursive: true });
  await writeFile(join(folderPath, "notes.txt"), "Project notes");
  await writeFile(join(folderPath, "Nested", "nested.txt"), "Nested notes");
  const folderChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload folder" }).focus();
  await page.keyboard.press("Enter");
  await (await folderChooser).setFiles(folderPath);
  await expect(page.getByRole("heading", { name: "2 files received" })).toBeVisible();
  await expect(page.getByText("Project/Nested/nested.txt", { exact: true })).toBeVisible();
  await screenshot(page, "drop-keyboard-folder-picker", info.project.name);
});
test("failed file reads show a retryable error", async ({ page }, info) => {
  await page.goto("/dev/components/drop-zone-overlay?state=read-error");
  await page
    .getByLabel("Choose files")
    .setInputFiles({ name: "failure.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
  await expect(appAlert(page)).toContainText("Can't read these files");
  await screenshot(page, "drop-read-error", info.project.name);
});
test("preview load failure keeps the download action", async ({ page }, info) => {
  await page.goto("/dev/components/preview-pane?kind=image");
  await expect(page.getByRole("img")).toBeVisible();
  await page.getByRole("img").dispatchEvent("error");
  await expect(appAlert(page)).toContainText("Can't preview this file");
  await expect(page.getByRole("link", { name: /^Download / })).toBeVisible();
  await screenshot(page, "preview-load-error", info.project.name);
});

test("directory traversal shows a loading state before dispatch", async ({ page }, info) => {
  await page.goto("/dev/components/drop-zone-overlay");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["pending"], "pending.txt"));
    const browser = window as unknown as { finishDrop?: () => void };
    Object.defineProperty(transfer, "items", {
      value: [
        {
          kind: "file",
          getAsFile: () => null,
          webkitGetAsEntry: () => ({
            name: "pending.txt",
            isFile: true,
            isDirectory: false,
            file: (ok: (file: File) => void) => {
              browser.finishDrop = () => ok(new File(["ready"], "pending.txt"));
            },
          }),
        },
      ],
    });
    document
      .querySelector(".su-drop-zone")
      ?.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
  });
  await expect(page.getByRole("region", { name: "Upload to Project notes" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByRole("button", { name: "Upload files" })).toBeDisabled();
  await screenshot(page, "drop-reading", info.project.name);
  await page.evaluate(() => (window as unknown as { finishDrop: () => void }).finishDrop());
  await expect(page.getByRole("heading", { name: "1 file received" })).toBeVisible();
  await accessible(page);
});
