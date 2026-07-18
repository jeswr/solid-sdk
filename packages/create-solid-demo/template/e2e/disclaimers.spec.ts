/**
 * The trust gates every surface must pass: the unremovable concept-demo banner
 * (copy asserted from the SAME disclaimer pack the components render from, so
 * asserted copy can never drift), the consent interstitial, and axe (WCAG 2.1 AA)
 * on the landing + every chapter page.
 */
import walkthroughJson from "@__CSD_SLUG__/app-tour/content/walkthrough.json";
import { documentDisclaimerPack, parseWalkthrough } from "@jeswr/solid-showcase";
import { disclaimerAssertions } from "@jeswr/solid-showcase-kit/testing";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const doc = parseWalkthrough(walkthroughJson);
const pack = documentDisclaimerPack(doc);
const consentCookie = `${doc.branding.consentCookiePrefix ?? `${doc.deploy.slug}-demo-consent-`}tour`;

/** Pre-set the consent cookie so non-interstitial tests start past the overlay. */
async function openWithConsent(page: Page, path: string) {
  await page
    .context()
    .addCookies([{ name: consentCookie, url: "http://localhost:3000", value: "1" }]);
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
}

async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function expectBanner(page: Page) {
  const banner = page.locator(disclaimerAssertions.bannerSelector).first();
  await expect(banner).toContainText(
    disclaimerAssertions.expectedBannerText(pack, {
      organization: doc.site.organization,
      variant: "own",
    }),
  );
}

test("landing: consent interstitial gates first entry", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: disclaimerAssertions.interstitialHeading }),
  ).toBeVisible();
});

test("landing: banner copy + axe", async ({ page }) => {
  await openWithConsent(page, "/");
  await expectBanner(page);
  await expectAxeClean(page);
});

for (const chapter of doc.chapters) {
  test(`chapter ${chapter.scene} (${chapter.slug}): banner copy + axe`, async ({ page }) => {
    await openWithConsent(page, `/chapters/${chapter.slug}`);
    await expectBanner(page);
    await expectAxeClean(page);
  });
}
