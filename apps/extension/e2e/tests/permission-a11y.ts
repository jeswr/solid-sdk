// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

export const permissionViewports = [375, 768, 1280].flatMap((width) =>
  (['light', 'dark'] as const).map((theme) => ({ width, theme })),
);

export async function setPermissionViewport(
  page: Page,
  width: number,
  theme: 'light' | 'dark',
): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.emulateMedia({ colorScheme: theme });
  // Match the shared theme resolver without reloading a pending preview (which denies it).
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.style.colorScheme = mode;
  }, theme);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  await page.evaluate(() => document.fonts.ready);
}

/** Check both the document and local containers: overflow:hidden must not conceal reflow bugs. */
export async function checkPermissionAccessibility(
  page: Page,
  scope: string,
  containers: string,
  artifact: string,
): Promise<void> {
  expect(
    await page.evaluate(() => ({
      document: document.documentElement.scrollWidth <= innerWidth,
      body: document.body.scrollWidth <= innerWidth,
    })),
  ).toEqual({ document: true, body: true });
  const overflow = await page.locator(containers).evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getClientRects().length > 0)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.left < -1 || rect.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1
        );
      })
      .map((node) => ({ tag: node.tagName, className: node.className, text: node.textContent })),
  );
  expect(overflow, `Horizontal overflow in ${artifact}`).toEqual([]);
  await test.info().attach(`${artifact}.png`, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
  const result = await new AxeBuilder({ page })
    .include(scope)
    .options({ rules: { 'color-contrast': { enabled: true } } })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations, `axe violations in ${artifact}`).toEqual([]);
  // A passing scan must actually measure contrast, rather than silently omit the rule.
  expect(
    result.passes.find(({ id }) => id === 'color-contrast')?.nodes.length ?? 0,
  ).toBeGreaterThan(0);
  expect(result.incomplete.filter(({ id }) => id === 'color-contrast')).toEqual([]);
}
