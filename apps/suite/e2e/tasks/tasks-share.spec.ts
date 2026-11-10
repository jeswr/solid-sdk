// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { Parser, Store } from "n3";
import { NS } from "../../src/apps/tasks/lib/model/rdf";

const bob = "https://bob.example/profile#me";
const homeUrl = "https://alice.demo.pod/tasks/projects/home.ttl";

test.beforeEach(async ({ page }) => {
  await page.route("**/__share-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__share-reset");
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
  await page.unroute("**/__share-reset");
});
async function data(page: Page, url: string) {
  const body = await page.evaluate(async (url) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = db.transaction("pods").objectStore("pods").get("https://alice.demo.pod/");
        request.onsuccess = () => {
          const resource = (
            request.result.snapshot.resources as [string, { body: Uint8Array }][]
          ).find(([key]) => key === url);
          resolve(new TextDecoder().decode(resource?.[1].body));
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, url);
  return new Store(new Parser({ baseIRI: url }).parse(body));
}
async function sidebar(page: Page) {
  if (!(await page.getByRole("navigation", { name: "Tasks", exact: true }).isVisible()))
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  return page.getByRole("navigation", { name: "Tasks", exact: true });
}

test("shares from both entry points, assigns without notification, and unassigns on revoke", async ({
  page,
}) => {
  await page.goto("/tasks/inbox");
  await expect(
    page.getByRole("heading", { name: "Your Inbox is empty", exact: true }),
  ).toBeVisible();
  const nav = await sidebar(page);
  await nav.getByRole("button", { name: "New project", exact: true }).click();
  const projectName = nav.getByRole("textbox", { name: "New project name", exact: true });
  await projectName.fill("Home");
  await projectName.press("Enter");
  await expect(page.getByRole("heading", { name: "No tasks yet", exact: true })).toBeVisible();
  await page
    .locator(".tsk-project-empty")
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("Shared chore");
  await title.press("Enter");
  await title.press("Escape");
  const row = page.locator("[data-task-url]").filter({ hasText: "Shared chore" });
  await expect(row).toBeVisible();
  const taskUrl = await row.getAttribute("data-task-url");
  if (!taskUrl) throw new Error("Missing task URL");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Share Home", exact: true });
  await expect(dialog).toContainText("Only you");
  const people = dialog.getByRole("combobox").first();
  await people.fill(bob);
  await people.press("Enter");
  await dialog.getByRole("combobox", { name: "New person's role", exact: true }).click();
  await page.getByRole("option", { name: "Editor", exact: true }).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toContainText(bob);
  await expect(dialog.getByLabel("Notify people")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await data(page, homeUrl))
        .getObjects(null, `${NS.VCARD}hasMember`, null)
        .map((term) => term.value),
    )
    .toContain(bob);
  const acl = "http://www.w3.org/ns/auth/acl#";
  for (const url of [`${homeUrl}.acl`, "https://alice.demo.pod/tasks/projects/home/.acl"])
    await expect
      .poll(async () => (await data(page, url)).getQuads(null, `${acl}agent`, bob, null).length)
      .toBe(1);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await row.getByRole("link", { name: "Shared chore", exact: true }).click();
  const detail = page.locator(".tsk-detail");
  const assignee = detail.locator(".tsk-detail-property").filter({ hasText: "Assignee" });
  await assignee.getByRole("combobox").fill(bob);
  await assignee.getByRole("combobox").press("Enter");
  await expect(detail).toContainText("bob.example will see this when they open the project");
  await expect
    .poll(async () =>
      (await data(page, taskUrl))
        .getObjects(null, `${NS.WF}assignee`, null)
        .map((term) => term.value),
    )
    .toEqual([bob]);
  await page.keyboard.press("Escape");
  const menuNav = await sidebar(page);
  await menuNav.getByRole("button", { name: "Project actions for Home", exact: true }).click();
  await page.getByRole("menuitem", { name: "Share", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Share Home", exact: true });
  await dialog.getByRole("combobox", { name: `Role for ${bob}`, exact: true }).click();
  await page.getByRole("option", { name: "Remove access", exact: true }).click();
  await expect
    .poll(
      async () => (await data(page, taskUrl)).getQuads(null, `${NS.WF}assignee`, null, null).length,
    )
    .toBe(0);
  await expect
    .poll(async () =>
      (await data(page, homeUrl))
        .getObjects(null, `${NS.VCARD}hasMember`, null)
        .map((term) => term.value),
    )
    .not.toContain(bob);
  const audit = await new AxeBuilder({ page }).analyze();
  expect(
    audit.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});
