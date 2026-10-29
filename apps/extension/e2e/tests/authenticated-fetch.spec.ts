import { expect, test } from '../fixtures';
import { grantOrigin, performLogin } from './helpers';

const TEST_SITE = 'http://localhost:8080';

test('authenticated fetch retrieves a private resource via window.solid', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);

  const page = await context.newPage();
  await page.goto(TEST_SITE);
  await grantOrigin(context, page);

  // The test site reads window.solid.webId + window.solid.fetch(private resource).
  await expect(page.locator('#webid')).toContainText('test-pod', { timeout: 15_000 });
  await expect(page.locator('#fetch-result')).toContainText('Private Note', { timeout: 15_000 });
  await expect(page.locator('#status')).toContainText('Private resource fetched successfully');
});

test('an ungranted origin stays stub-only and revocation stops a captured fetch', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);
  const page = await context.newPage();
  await page.goto(TEST_SITE);
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys((window as unknown as { solid: object }).solid).sort()),
    )
    .toEqual(['login', 'requestAccess']);
  await grantOrigin(context, page);
  await expect(page.locator('#fetch-result')).toContainText('Private Note');
  await page.evaluate(() => {
    (window as unknown as { capturedFetch: unknown }).capturedFetch = (
      window as unknown as { solid: { fetch: unknown } }
    ).solid.fetch;
  });
  const other = await context.newPage();
  await other.goto('http://localhost:8081');
  await expect
    .poll(() =>
      other.evaluate(() => Object.keys((window as unknown as { solid: object }).solid).sort()),
    )
    .toEqual(['login', 'requestAccess']);
  const owner = await context.newPage();
  await owner.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  expect(
    (
      await owner.evaluate(() =>
        chrome.runtime.sendMessage({
          type: 'SOLID_ORIGIN_GRANT_REVOKE',
          origin: 'http://localhost:8080',
        }),
      )
    ).ok,
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys((window as unknown as { solid: object }).solid).sort()),
    )
    .toEqual(['login', 'requestAccess']);
  expect(
    await page.evaluate(async () => {
      try {
        await (
          window as unknown as { capturedFetch: (url: string) => Promise<Response> }
        ).capturedFetch('http://localhost:3000/test-pod/private/notes');
        return 'unexpected success';
      } catch (error) {
        return (error as Error).message;
      }
    }),
  ).toMatch(/not granted/);
});
