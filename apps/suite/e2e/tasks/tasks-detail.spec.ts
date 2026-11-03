// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { Parser, Store } from "n3";
import { NS, SCHED, SCHEMA } from "../../src/apps/tasks/lib/model/rdf";
import { encodeRef } from "../../src/lib/refs";

test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__tasks-test-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__tasks-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo database deletion blocked"));
    });
  });
  await page.unroute("**/__tasks-test-reset");
});

/** Inspect the durable demo pod cache, without adding a production window hook. */
async function resources(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ url: string; text: string }[]>((resolve, reject) => {
        const request = db.transaction("pods").objectStore("pods").get("https://alice.demo.pod/");
        request.onsuccess = () =>
          resolve(
            (request.result.snapshot.resources as [string, { body: Uint8Array }][])
              .filter(([url]) => url.includes("/tasks/"))
              .map(([url, resource]) => ({ url, text: new TextDecoder().decode(resource.body) })),
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
async function taskData(page: Page, url: string) {
  const resource = (await resources(page)).find((item) => item.url === url);
  return new Store(new Parser({ baseIRI: url }).parse(resource?.text ?? ""));
}
async function addTask(page: Page, title: string) {
  await page.goto("/tasks/inbox");
  await expect(
    page.getByRole("heading", { name: "Your Inbox is empty", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("q");
  const input = page.getByRole("textbox", { name: "Task title", exact: true });
  await input.fill(title);
  await input.press("Enter");
  await input.press("Escape");
  const row = page.locator("[data-task-url]").filter({ hasText: title });
  await expect(row).toBeVisible();
  const url = await row.getAttribute("data-task-url");
  if (!url) throw new Error("Missing task URL");
  return { row, url };
}
async function closeDetails(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "Back", exact: true }).click();
  else await page.getByRole("button", { name: "Close task details", exact: true }).click();
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
}

test("sub-task progress, properties, exact RDF and focus return", async ({ page }) => {
  const { row, url } = await addTask(page, "Water plants");
  await row.getByRole("link", { name: "Water plants", exact: true }).click();
  const detail = page.getByRole("region", { name: "Task details: Water plants", exact: true });
  await expect(detail.getByRole("textbox", { name: "Task title", exact: true })).toBeFocused();
  await detail.getByRole("button", { name: "Add sub-task", exact: true }).click();
  const subtask = detail.getByRole("textbox", { name: "Sub-task title", exact: true });
  await subtask.fill("Buy soil");
  await subtask.press("Enter");
  await expect(detail.getByRole("heading", { name: /Sub-tasks/ })).toContainText("0/1");
  await subtask.press("Escape");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Add sub-task", exact: true })).toBeFocused();
  await detail.getByRole("checkbox", { name: "Complete 'Buy soil'", exact: true }).click();
  await expect(detail.getByRole("heading", { name: /Sub-tasks/ })).toContainText("1/1");
  await expect(
    detail.getByRole("checkbox", { name: "Complete 'Water plants'", exact: true }),
  ).not.toBeChecked();
  await detail.getByRole("radio", { name: "P1", exact: true }).click();
  const due = detail.getByRole("textbox", { name: "Due date", exact: true });
  await due.fill("3 November 2027 5pm");
  await due.press("Tab");
  await detail.getByRole("textbox", { name: "New label name", exact: true }).fill("garden");
  await detail.getByRole("button", { name: "Create label", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Remove garden", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.getByRole("button", { name: "1 hour before", exact: true }).click();
  await page.keyboard.press("Escape");
  const description = detail.getByRole("textbox", { name: "Description", exact: true });
  await description.fill(
    "Care: https://example.org/plants <script>alert(1)</script> javascript:alert(1)",
  );
  await description.press("Tab");
  await expect(
    detail.getByRole("link", { name: "https://example.org/plants", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect(detail.locator("script")).toHaveCount(0);
  await expect
    .poll(async () => {
      const data = await taskData(page, url);
      const subject = `${url}#it`;
      return {
        priority: data.getObjects(subject, `${SCHEMA}priority`, null).map((term) => term.value),
        due: data.getObjects(subject, `${NS.WF}dateDue`, null).map((term) => term.value),
        labels: data
          .getObjects(subject, `${NS.RDF}type`, null)
          .map((term) => term.value)
          .filter((value) => value.endsWith("#label-garden")),
        reminders: data
          .getQuads(null, `${SCHED}triggerOffset`, null, null)
          .map((quad) => quad.object.value),
        descriptions: [`${NS.WF}description`, `${NS.DCT}description`].map(
          (predicate) => data.getObjects(subject, predicate, null)[0]?.value,
        ),
      };
    })
    .toEqual({
      priority: ["high"],
      due: ["2027-11-03T17:00:00.000Z"],
      labels: ["https://alice.demo.pod/tasks/projects/inbox.ttl#label-garden"],
      reminders: ["-PT1H"],
      descriptions: [
        "Care: https://example.org/plants <script>alert(1)</script> javascript:alert(1)",
        "Care: https://example.org/plants <script>alert(1)</script> javascript:alert(1)",
      ],
    });
  const child = (await resources(page)).find((item) => item.text.includes('"Buy soil"'));
  expect(child).toBeTruthy();
  const childData = new Store(new Parser({ baseIRI: child?.url }).parse(child?.text ?? ""));
  expect(childData.getObjects(null, `${NS.DCT}isPartOf`, null).map((term) => term.value)).toEqual([
    `${url}#it`,
  ]);
  expect(childData.getQuads(null, `${NS.RDF}type`, `${NS.WF}Closed`, null)).toHaveLength(1);
  await accessible(page);
  await closeDetails(page);
  await expect(page).not.toHaveURL(/\?task=/);
  await expect(row).toBeFocused();
  await row.focus();
  await row.press("Enter");
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
});

test("unknown/invalid refs, row Edit link, title commit, recurrence clearing and duplicate", async ({
  page,
}) => {
  const { row, url } = await addTask(page, "Original");
  await row.hover();
  await row.getByRole("button", { name: "Actions for 'Original'", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const detail = page.locator(".tsk-detail");
  const title = detail.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("");
  await title.press("Enter");
  await expect(title).toHaveValue("Original");
  await title.fill("Renamed");
  await title.press("Enter");
  await detail.getByRole("textbox", { name: "Due date", exact: true }).fill("3 November 2027");
  await detail.getByRole("textbox", { name: "Due date", exact: true }).press("Tab");
  await detail.getByRole("button", { name: "Repeat", exact: true }).click();
  await page.getByLabel("Frequency", { exact: true }).selectOption("DAILY");
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Every day");
  await detail.getByRole("button", { name: "Add reminder", exact: true }).click();
  await expect(page.getByRole("button", { name: "At due time", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "1 day before", exact: true }).click();
  await page.keyboard.press("Escape");
  const due = detail.getByRole("textbox", { name: "Due date", exact: true });
  await due.fill("");
  await due.press("Tab");
  await expect
    .poll(
      async () =>
        (await taskData(page, url)).getQuads(null, `${SCHED}hasReminder`, null, null).length,
    )
    .toBe(0);
  expect((await taskData(page, url)).getQuads(null, `${SCHED}recurrence`, null, null)).toHaveLength(
    0,
  );
  await detail.getByRole("button", { name: "Task actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await closeDetails(page);
  await expect(page.getByRole("link", { name: "Renamed", exact: true })).toHaveCount(2);
  for (const ref of [
    "invalid!",
    encodeRef("https://alice.demo.pod/tasks/projects/inbox/missing.ttl"),
  ]) {
    await page.goto(`/tasks/inbox?task=${ref}`);
    await expect(page.locator('.tsk-detail [data-category="not-found"]')).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page).toHaveURL("/tasks/inbox");
  }
  await accessible(page);
});
