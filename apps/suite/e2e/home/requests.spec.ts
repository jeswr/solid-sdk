// AUTHORED-BY Claude Opus 5.5
// 03-home-permissions §9 scenarios 9 and 10. The server and this runner share SUITE_TEST_CAPS:
//   SUITE_TEST_CAPS='{"accessRequests":true,"grantExpiry":true}'  scenario 9 (expiring access)
//   SUITE_TEST_CAPS='{"accessRequests":true}'                     scenario 9 (WAC: no expiry)
//   SUITE_TEST_CAPS unset                                         scenario 10
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { Parser } from "n3";

const ROOT = "https://alice.demo.pod/";
const REQUEST = `${ROOT}inbox/maracoach-activity.ttl`;
const REQUESTER = "https://maracoach.example/profile/card#me";
const ACCM = "https://jeswr.org/ns/accm#";
const DPV = "https://w3id.org/dpv#";
const ACL = "http://www.w3.org/ns/auth/acl#";
const caps = JSON.parse(process.env.SUITE_TEST_CAPS || "{}") as {
  accessRequests?: boolean;
  grantExpiry?: boolean;
};

test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__requests-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__requests-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo storage still open"));
    });
  });
  await page.unroute("**/__requests-reset");
  // The requester is never contacted from the browser demo; no foreign network is needed.
  await page.route("https://maracoach.example/**", (route) => route.abort());
  await page.route("https://bob.demo.pod/**", (route) => route.abort());
});

async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}

/** Every stored document under `prefix` in the durable demo pod the page uses. */
async function podDocuments(page: Page, prefix: string): Promise<[string, string][]> {
  return page.evaluate(
    async ({ root, prefix }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("solid-suite-demo", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const stored = await new Promise<{
          snapshot: { resources: [string, { body: Uint8Array }][] };
        }>((resolve, reject) => {
          const request = db.transaction("pods").objectStore("pods").get(root);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return stored.snapshot.resources
          .filter(([id]) => id.startsWith(prefix))
          .map(
            ([id, resource]) => [id, new TextDecoder().decode(resource.body)] as [string, string],
          );
      } finally {
        db.close();
      }
    },
    { root: ROOT, prefix },
  );
}
function objects(turtle: string, baseIRI: string, predicate: string): string[] {
  return new Parser({ baseIRI })
    .parse(turtle)
    .filter((q) => q.predicate.value === predicate)
    .map((q) => q.object.value);
}

test.describe("scenario 9: requests (accessRequests)", () => {
  test.skip(caps.accessRequests !== true, "Needs SUITE_TEST_CAPS with accessRequests");

  test("review from the badge, approve with the requested duration, see it in Decided", async ({
    page,
  }) => {
    await page.goto("/permissions");
    const link = page.locator("a.hm-permission-requests");
    await expect(link).toHaveAccessibleName(/^Requests\s*1 pending$/);
    await expect(link.locator(".hm-permission-count")).toHaveText("1 pending");
    await link.click();
    await expect(page).toHaveURL("/permissions/requests");
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
    const row = page.getByRole("listitem", { name: "Request from MaraCoach" });
    await expect(row).toContainText("Activity");
    await expect(row).toContainText("Build your training plan");
    await expect(row).toContainText("For 1 month");
    await accessible(page);

    await row.getByRole("button", { name: "Review" }).focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", {
      name: "To build your training plan, MaraCoach requests access to:",
    });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: "Activity" })).toBeChecked();
    const [cancel, share] = [
      sheet.getByRole("button", { name: "Cancel", exact: true }),
      sheet.getByRole("button", { name: "Share", exact: true }),
    ];
    // Equal weight: same size and the same visual treatment.
    const style = (button: typeof share) =>
      button.evaluate((element) => {
        const css = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return [
          css.backgroundColor,
          css.color,
          css.fontWeight,
          css.borderTopWidth,
          box.width,
          box.height,
        ];
      });
    expect(await style(cancel)).toEqual(await style(share));
    if (caps.grantExpiry) {
      await expect(sheet.getByRole("radio", { name: "1 month" })).toBeChecked();
    } else {
      await expect(sheet.getByRole("radio", { name: "Until revoked" })).toBeChecked();
      await expect(sheet.getByRole("radio", { name: "1 month" })).toBeDisabled();
      await expect(sheet).toContainText("Expiring access isn't available on this storage");
    }
    await accessible(page);
    const approvedAt = Date.now();
    await share.click();
    await expect(sheet).toBeHidden();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "MaraCoach can now see your Activity." }),
    ).toBeVisible();
    await expect(page.getByText("No requests waiting", { exact: false })).toBeVisible();
    await page.getByRole("tab", { name: "Decided" }).click();
    await expect(page.getByRole("listitem", { name: "Request from MaraCoach" })).toContainText(
      "Approved",
    );

    const [request] = await podDocuments(page, REQUEST);
    expect(objects(request?.[1] ?? "", REQUEST, `${ACCM}status`)).toEqual([`${ACCM}Approved`]);
    const receipts = (await podDocuments(page, `${ROOT}settings/access-records/receipt-`)).filter(
      ([url, body]) => objects(body, url, `${ACCM}requestRef`).includes(REQUEST),
    );
    expect(receipts).toHaveLength(1);
    const [receiptUrl, receipt] = receipts[0] as [string, string];
    const expiry = objects(receipt, receiptUrl, `${DPV}hasExpiryTime`);
    if (caps.grantExpiry) {
      const expected = new Date(approvedAt);
      expected.setMonth(expected.getMonth() + 1);
      expect(expiry).toHaveLength(1);
      expect(Math.abs(Date.parse(expiry[0] as string) - expected.getTime())).toBeLessThan(120_000);
    } else expect(expiry).toEqual([]);
    // The grant lands on the registered Activity document alone, never on the health/ folder.
    const [acl] = await podDocuments(page, `${ROOT}health/activity.ttl.acl`);
    expect(objects(acl?.[1] ?? "", `${ROOT}health/activity.ttl.acl`, `${ACL}agent`)).toContain(
      REQUESTER,
    );
    const [folderAcl] = await podDocuments(page, `${ROOT}health/.acl`);
    expect(folderAcl).toBeDefined();
    expect(objects(folderAcl?.[1] ?? "", `${ROOT}health/.acl`, `${ACL}agent`)).not.toContain(
      REQUESTER,
    );
    const granted = (await podDocuments(page, ROOT)).filter(
      ([url, body]) =>
        url.endsWith(".acl") && objects(body, url, `${ACL}agent`).includes(REQUESTER),
    );
    expect(granted.map(([url]) => url)).toEqual([`${ROOT}health/activity.ttl.acl`]);
  });

  test("Cancel asks before denying; Keep reviewing keeps the sheet", async ({ page }) => {
    await page.goto("/permissions/requests");
    await page
      .getByRole("listitem", { name: "Request from MaraCoach" })
      .getByRole("button", { name: "Review" })
      .click();
    const sheet = page.getByRole("dialog", { name: /MaraCoach requests access to:$/ });
    await sheet.getByRole("checkbox", { name: "Select all" }).click();
    await expect(sheet.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Deny this request?" });
    await expect(confirm).toBeVisible();
    await accessible(page);
    await confirm.getByRole("button", { name: "Keep reviewing" }).click();
    await expect(confirm).toBeHidden();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await confirm.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "You denied MaraCoach's request." }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Decided" }).click();
    await expect(page.getByRole("listitem", { name: "Request from MaraCoach" })).toContainText(
      "Denied",
    );
    expect(await podDocuments(page, `${ROOT}health/activity.ttl.acl`)).toEqual([]);
  });
});

test.describe("scenario 10: requests hidden (no accessRequests)", () => {
  test.skip(caps.accessRequests === true, "Runs without accessRequests");

  test("no Requests tab, and the route redirects to Permissions", async ({ page }) => {
    await page.goto("/permissions");
    await expect(page.getByRole("heading", { level: 1, name: "Permissions" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Permissions" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Requests/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Requests/ })).toHaveCount(0);
    await page.goto("/permissions/requests");
    await expect(page).toHaveURL("/permissions");
    await expect(page.getByRole("heading", { level: 1, name: "Permissions" })).toBeVisible();
    await accessible(page);
  });
});
