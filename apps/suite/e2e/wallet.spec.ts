// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { credentialToJsonLd, generateKeyPairForSuite, issue } from "@jeswr/solid-vc";
import { expect, test } from "@playwright/test";

test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00Z"));
  await page.route("**/__wallet-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Wallet reset</title>" }),
  );
  await page.goto("/__wallet-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod is open in another page"));
    });
  });
  await page.unroute("**/__wallet-reset");
  await page.goto("/wallet");
  await expect(page.getByRole("heading", { name: "Your wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rowan's passport", exact: true })).toBeVisible();
});
for (const width of [375, 768, 1280])
  test(`adds, edits, previews, searches and undoes deletion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("region", { name: "Expiring soon" })).toContainText(
      "Travel insurance",
    );
    await page.getByRole("button", { name: "Add document", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add document", exact: true });
    await add.getByLabel("Name", { exact: true }).fill("Meadow travel pass");
    await add.getByLabel("Document kind").selectOption("ticket");
    await add.getByLabel("Number or identifier").fill("DEMO-TRAVEL-42");
    await add.getByLabel("Expires", { exact: true }).fill("2026-11-30");
    await add.getByLabel("Attach scan or PDF").setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqQoAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await add.getByRole("button", { name: "Save document", exact: true }).click();
    await expect(add).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Saving changes" })).toHaveCount(0);
    await page.getByLabel("Search wallet").fill("DEMO-TRAVEL-42");
    await page.getByRole("button", { name: "Meadow travel pass", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "Meadow travel pass", exact: true });
    await expect(detail.getByRole("region", { name: "Attached file" })).toBeVisible();
    await expect(
      detail.getByRole("img", { name: "Meadow travel pass", exact: true }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await detail.getByRole("button", { name: "Edit document", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit document", exact: true });
    await edit.getByLabel("Name", { exact: true }).fill("Meadow rail pass");
    await edit.getByRole("button", { name: "Save document", exact: true }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Saving changes" })).toHaveCount(0);
    await page.getByRole("button", { name: "Meadow rail pass", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete document", exact: true })
      .click();
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toHaveAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
    await undo.focus();
    await page.keyboard.press("Control+z");
    await expect(page.getByRole("button", { name: "Meadow rail pass", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Meadow rail pass", exact: true })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
test("re-verifies the signed fictional credential and imports the exact JSON-LD through paste and file upload", async ({
  page,
}) => {
  const credentialCard = page
    .locator("article")
    .filter({ hasText: "Woodland first aid credential" });
  await expect(credentialCard).toContainText("Expires 2027-11-11");
  await expect(credentialCard).toContainText("Unverified claims");
  await expect(credentialCard.locator(".lucide-shield-check")).toHaveCount(0);
  await page.getByRole("button", { name: "Woodland first aid credential", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Verified by / })).toBeVisible();
  await expect(page.getByRole("region", { name: "Credential verification" })).toContainText(
    "Rowan Meadow",
  );
  // Demo verification checks a real signature; it is never replaced with a flag.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add credential", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add credential", exact: true });
  await expect(add.getByLabel("Name (optional)")).toHaveAttribute("maxlength", "1000");
  await expect(add.getByLabel("Credential JSON-LD")).toHaveAttribute("maxlength", "262144");
  await add.getByLabel("Credential JSON-LD").fill("{broken");
  await add.getByRole("button", { name: "Save credential", exact: true }).click();
  await expect(add.getByRole("alert")).toBeVisible();
  const key = await generateKeyPairForSuite("https://academy.example/profile#key", "Ed25519");
  const signed = await issue({
    credential: {
      issuer: "https://academy.example/profile",
      credentialSubject: { "https://schema.org/name": "Fictional course" },
    },
    key,
    options: { created: new Date("2026-11-10T00:00:00Z") },
  });
  const source = JSON.stringify({ ...credentialToJsonLd(signed), proof: signed.proof });
  await add.getByLabel("Name (optional)").fill("Pasted fictional course");
  await add.getByLabel("Credential JSON-LD").fill(source);
  await add.getByRole("button", { name: "Save credential", exact: true }).click();
  await expect(add).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Saving changes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pasted fictional course", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Could not check", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add credential", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "Add credential", exact: true });
  await upload.getByLabel("Name (optional)").fill("Uploaded fictional course");
  await upload.getByLabel("Upload a JSON credential").setInputFiles({
    name: "credential.json",
    mimeType: "application/json",
    buffer: Buffer.from(source),
  });
  await expect(upload.getByLabel("Credential JSON-LD")).toHaveValue(source);
  await upload.getByRole("button", { name: "Save credential", exact: true }).click();
  await expect(upload).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Uploaded fictional course", exact: true }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});
