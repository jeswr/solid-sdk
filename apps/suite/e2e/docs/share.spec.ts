// AUTHORED-BY Codex GPT-6.1
import { parseRdf } from "@jeswr/fetch-rdf";
import { expect, type Page, test } from "@playwright/test";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { docContainerUrls } from "../../src/apps/docs/lib/model/layout";
import { decodeRef } from "../../src/lib/refs";

async function companionGrants(page: Page, person: string) {
  const resource = decodeRef(new URL(page.url()).pathname.split("/").at(-1) as string);
  const { container } = docContainerUrls(resource);
  const url = `${container}.acl`;
  const turtle = await page.evaluate(async (url) => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Demo pod is not ready");
    const response = await pod.fetch(url);
    if (!response.ok) throw new Error(`Companion ACL read failed: ${response.status}`);
    return response.text();
  }, url);
  const dataset = await parseRdf(turtle, "text/turtle", { baseIRI: url });
  return [...new AclResource(dataset, DataFactory).authorizations]
    .filter((rule) => rule.agent.has(person) || rule.agentClass.has(person))
    .map((rule) => ({
      accessTo: rule.accessTo,
      defaults: rule.default,
      modes: [...rule.mode].sort(),
    }));
}

const BOB = "https://bob.example.org/profile#me";

test.beforeEach(async ({ page }) => {
  await page.route("**/__docs-share-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__docs-share-reset");
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
  await page.unroute("**/__docs-share-reset");
});

test("shares a saved document from its header and File menu, persisting document and companion access", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/new");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeDisabled();
  await share.locator("..").focus();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Save this document to your pod before sharing.",
  );
  await page.getByRole("textbox", { name: "Document title", exact: true }).fill("Shared plan");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Our shared plan");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(share).toBeEnabled();
  const documentUrl = page.url();
  await share.click();
  let dialog = page.getByRole("dialog", { name: "Share “Shared plan”" });
  await expect(dialog.getByRole("note")).toHaveCount(0);
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1280);
  await dialog.getByRole("combobox", { name: "Add people" }).fill(BOB);
  await dialog.getByRole("button", { name: "Add person" }).click();
  await dialog.getByLabel("Role for added people").selectOption("editor");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveValue("editor");
  const companion = docContainerUrls(
    decodeRef(new URL(page.url()).pathname.split("/").at(-1) as string),
  ).container;
  expect(await companionGrants(page, BOB)).toEqual([
    {
      accessTo: companion,
      defaults: companion,
      modes: ["Append", "Read", "Write"].map((mode) => `http://www.w3.org/ns/auth/acl#${mode}`),
    },
  ]);
  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByText("Link copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(documentUrl);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(share).toBeFocused();
  await page.reload();
  await expect(body).toContainText("Our shared plan");
  await expect(share).toBeEnabled();
  const file = page.getByRole("menuitem", { name: "File", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  const menuShare = page.getByRole("menuitem", { name: "Share…", exact: true });
  await menuShare.focus();
  await menuShare.press("Enter");
  dialog = page.getByRole("dialog", { name: "Share “Shared plan”" });
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveValue("editor");
  await dialog.getByLabel("Who can access").selectOption("anyone");
  await expect(dialog.getByLabel("Link role")).toHaveValue("viewer");
  await expect(dialog.getByText("Sharing saved", { exact: true })).toBeVisible();
  expect(await companionGrants(page, "http://xmlns.com/foaf/0.1/Agent")).toEqual([
    {
      accessTo: companion,
      defaults: companion,
      modes: ["http://www.w3.org/ns/auth/acl#Read"],
    },
  ]);
  await dialog.getByRole("button", { name: `Remove access for ${BOB}` }).click();
  await expect(dialog.getByLabel(`Role for ${BOB}`)).toHaveCount(0);
  expect(await companionGrants(page, BOB)).toEqual([]);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(file).toBeFocused();
});

test("disables header and menu sharing offline and restores them on reconnect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("docs-share-offline") !== "1",
    });
  });
  await page.goto("/docs/new");
  await page.getByRole("textbox", { name: "Document body", exact: true }).fill("A saved document");
  await expect(page).toHaveURL(/\/docs\/d\//);
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeEnabled();
  await share.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Who can access")).toBeEnabled();
  await page.evaluate(() => {
    sessionStorage.setItem("docs-share-offline", "1");
    dispatchEvent(new Event("offline"));
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Who can access")).toBeDisabled();
  await expect(dialog.getByText("Reconnect to manage sharing.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(share).toBeDisabled();
  await expect(share).toBeFocused();
  await expect(share).toHaveAccessibleDescription("Reconnect to manage sharing.");
  await share.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Reconnect to manage sharing.");
  const file = page.getByRole("menuitem", { name: "File", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  const menuShare = page.getByRole("menuitem", { name: "Share…", exact: true });
  await expect(menuShare).toBeDisabled();
  await expect(menuShare).toHaveAccessibleDescription("Reconnect to manage sharing.");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    sessionStorage.removeItem("docs-share-offline");
    dispatchEvent(new Event("online"));
  });
  await expect(share).toBeEnabled();
});
