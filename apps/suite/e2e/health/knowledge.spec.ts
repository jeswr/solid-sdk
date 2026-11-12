// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
import { expect, type Page, test } from "@playwright/test";
import { accessible, ready, resetHealthDemo } from "./helpers";

const fixture = fileURLToPath(new URL("fixtures/knowledge.trig", import.meta.url));
const fictionalOwner = "https://example.org/people/robin#me";
test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await resetHealthDemo(page);
  await ready(page, "/health/knowledge", "What your assistant knows");
  await expect(page.getByRole("status", { name: "Knowledge data source" })).toContainText(
    "Fictional sample",
    { timeout: 30000 },
  );
});
async function facts(page: Page) {
  await page.getByRole("tab", { name: "Facts", exact: true }).click();
  return page.getByRole("list", { name: "Health facts", exact: true });
}
async function openFact(page: Page, label: string) {
  const list = await facts(page);
  await page.getByLabel("Filter facts", { exact: true }).fill(label);
  const trigger = list.getByRole("button").filter({ hasText: label }).first();
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: label, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}
test("sample hashes match Node, every tab is accessible and captured, and tabs support keyboard navigation", async ({
  page,
}, info) => {
  const sample = await exampleHealthKnowledge();
  await facts(page);
  expect(
    await page
      .locator("[data-fact-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-fact-id")).sort()),
  ).toEqual(sample.nanopubs.map((np) => np.id).sort());
  await expect(page.getByText("77 of 77 facts", { exact: false })).toBeVisible();
  const directory = fileURLToPath(new URL("../../test-results/knowledge/", import.meta.url));
  await mkdir(directory, { recursive: true });
  for (const [tab, heading] of [
    ["Overview", "Needs your review"],
    ["Timeline", "Your health timeline"],
    ["Results", "Results recorded by your assistant"],
    ["Facts", "All health facts"],
    ["Notes", "Other things your assistant noted"],
  ] as const) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#${tab?.toLowerCase()}$`));
    await accessible(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `${directory}/${info.project.name}-${tab?.toLowerCase()}.png`,
      fullPage: true,
      style: ".ish-frame { height: auto; overflow: visible; } .ish-main { overflow: visible; }",
    });
  }
  await page.getByRole("tab", { name: "Overview", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Timeline", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const timeline = page.getByRole("group", { name: "Timeline belief", exact: true });
  await expect(timeline.getByRole("button", { name: "Definitely", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(timeline.getByRole("button", { name: "Past", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("tab", { name: "Timeline", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 320, height: 900 });
  for (const tab of ["Overview", "Timeline", "Results", "Facts", "Notes"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test("belief and kind chips filter facts and a sheet exposes the full provenance", async ({
  page,
}) => {
  const list = await facts(page);
  const belief = page.getByRole("group", { name: "Fact belief", exact: true });
  await belief.getByRole("button", { name: "Might", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(3);
  const kind = page.getByRole("group", { name: "Fact kind", exact: true });
  await kind.getByRole("button", { name: "Note", exact: true }).click();
  await expect(page.getByText("No matching facts", { exact: true })).toBeVisible();
  await kind.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByLabel("Filter facts", { exact: true }).fill("sleep");
  await expect(list.getByRole("button")).toHaveCount(1);
  await list.getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: "Possible sleep apnoea", exact: true });
  await expect(sheet.getByRole("heading", { name: "Provenance", exact: true })).toBeVisible();
  await expect(sheet).toContainText("Fictional journal entry for condition-hedged.");
  await expect(sheet).toContainText("fictional-codex-model");
  await expect(sheet).toContainText("Fictional demo extractor");
  await expect(sheet).toContainText("example-health-avery");
  await expect(sheet).toContainText("me ·");
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(list.getByRole("button")).toBeFocused();
});
test("Forget appends history and moves the original fact to Past while offline", async ({
  page,
  context,
}) => {
  const sheet = await openFact(page, "Vitamin D deficiency");
  await context.setOffline(true);
  await sheet.getByRole("button", { name: "Forget", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Forget this fact?", exact: true });
  await expect(confirmation).toContainText(
    "Your assistant will stop using this. The history is kept.",
  );
  await confirmation.getByRole("button", { name: "Forget fact", exact: true }).click();
  await expect(confirmation).toBeHidden({ timeout: 20000 });
  await expect(sheet.locator(".hlt-knowledge-badge")).toHaveText("Past", { timeout: 20000 });
  await expect(sheet.getByRole("button", { name: "Forget", exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("group", { name: "Fact belief", exact: true })
    .getByRole("button", { name: "Past", exact: true })
    .click();
  await expect(
    page.getByRole("list", { name: "Health facts", exact: true }).getByRole("button"),
  ).toHaveCount(2);
});
test("Correct adds an owner revision and links the Past fact to its replacement", async ({
  page,
}) => {
  const sheet = await openFact(page, "Balance concern clarified");
  await sheet.getByRole("button", { name: "Correct", exact: true }).click();
  await sheet.getByLabel("Name", { exact: true }).fill("Fictional balance correction");
  await sheet.getByLabel("Start date", { exact: true }).fill("2026-03-03");
  await sheet.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(sheet.locator(".hlt-knowledge-badge")).toHaveText("Past", { timeout: 20000 });
  await sheet
    .getByRole("button", { name: "View replacement: Fictional balance correction", exact: true })
    .click();
  const replacement = page.getByRole("dialog", {
    name: "Fictional balance correction",
    exact: true,
  });
  await expect(replacement.locator(".hlt-knowledge-badge")).toHaveText("Definitely");
  await expect(replacement).toContainText("3 Mar 2026");
  await expect(replacement).toContainText("Correction supplied by the owner.");
  await accessible(page);
});
test("a local fictional file changes source, reprojects another owner, and disables mutations without requests or durable writes", async ({
  page,
}) => {
  const requests: string[] = [];
  const writes: string[] = [];
  await page.evaluate(() => {
    const refuse = () => {
      throw new Error("Knowledge must stay in memory");
    };
    Storage.prototype.setItem = refuse;
    IDBObjectStore.prototype.put = refuse;
    IDBObjectStore.prototype.add = refuse;
    window.fetch = refuse;
    XMLHttpRequest.prototype.send = refuse;
  });
  page.on("request", (request) => {
    requests.push(request.method());
  });
  page.on("pageerror", (error) => {
    writes.push(error.name);
  });
  await page.getByLabel("Choose a knowledge graph file", { exact: true }).setInputFiles(fixture);
  await expect(page.getByRole("status", { name: "Knowledge data source" })).toContainText(
    "Local file",
  );
  await expect(page.getByText("0 nanopublications skipped.", { exact: true })).toBeVisible();
  const list = await facts(page);
  await expect(page.getByText("No matching facts", { exact: true })).toBeVisible();
  await page.getByLabel("Owner WebID", { exact: true }).fill(fictionalOwner);
  await page.getByRole("button", { name: "Apply owner to open file", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(3);
  await list.getByRole("button").filter({ hasText: "Fictional imported pollen allergy" }).click();
  const sheet = page.getByRole("dialog", {
    name: "Fictional imported pollen allergy",
    exact: true,
  });
  await expect(sheet.getByRole("button", { name: "Correct", exact: true })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: "Forget", exact: true })).toBeDisabled();
  await expect(
    sheet.getByText("Open it from your pod to make changes", { exact: true }),
  ).toBeVisible();
  await expect(sheet).toContainText("Mar 2025");
  await expect(
    sheet.getByRole("link", { name: "Open source: Fictional imported journal", exact: true }),
  ).toHaveAttribute("referrerpolicy", "no-referrer");
  await accessible(page);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Choose a knowledge graph file", { exact: true }).setInputFiles({
    name: "invalid.trig",
    mimeType: "application/trig",
    buffer: Buffer.from("private malformed content"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn't open this knowledge graph. Check the file and the owner's HTTP(S) WebID.",
  );
  await expect(page.getByRole("status", { name: "Knowledge data source" })).toContainText(
    "Local file",
  );
  expect(requests).toEqual([]);
  expect(writes).toEqual([]);
});

for (const [label, medication] of [
  ["Fictional pollen allergy", false],
  ["Fictional vitamin D supplement", true],
] as const) {
  test(`corrects ${medication ? "a medication dose" : "an allergy"} with the owner form`, async ({
    page,
  }) => {
    const sheet = await openFact(page, label);
    await sheet.getByRole("button", { name: "Correct", exact: true }).click();
    await sheet.getByLabel("Name", { exact: true }).fill("Fictional updated owner record");
    await sheet.getByLabel("Start date", { exact: true }).fill("2025-03");
    await sheet.getByLabel("End date", { exact: true }).fill("2024");
    await sheet.getByRole("button", { name: "Save correction", exact: true }).click();
    await expect(sheet.getByRole("alert")).toContainText("The end must be on or after the start");
    await sheet.getByLabel("End date", { exact: true }).fill("");
    if (medication) {
      await sheet.getByLabel("Dose", { exact: true }).fill("2.50");
      await sheet.getByLabel("Dose unit", { exact: true }).fill("tablet");
    }
    await sheet.getByRole("button", { name: "Save correction", exact: true }).click();
    await expect(sheet.locator(".hlt-knowledge-badge")).toHaveText("Past", { timeout: 20000 });
    await sheet
      .getByRole("button", {
        name: "View replacement: Fictional updated owner record",
        exact: true,
      })
      .click();
    const replacement = page.getByRole("dialog", {
      name: "Fictional updated owner record",
      exact: true,
    });
    await expect(replacement).toContainText("Mar 2025");
    if (medication) {
      await expect(replacement).toContainText("2.50");
      await expect(replacement).toContainText("tablet");
      await expect(replacement).toContainText("daily");
    }
  });
}
