import { expect, test } from '../fixtures';
import { grantTestSite, performLogin, TEST_WEBID } from './helpers';

const TEST_SITE = 'http://localhost:8080';

test('authenticated fetch retrieves a private resource via window.solid', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);

  const page = await context.newPage();
  await page.goto(TEST_SITE);

  // Popup sign-in cannot disclose identity or pod bytes to an ungranted app.
  const denied = await page.evaluate(async (privateUrl) => {
    const solid = (
      window as unknown as {
        solid: { webId: string | null; fetch(url: string): Promise<Response> };
      }
    ).solid;
    try {
      await solid.fetch(privateUrl);
      return { webId: solid.webId, error: null };
    } catch (error) {
      return { webId: solid.webId, error: (error as Error).message };
    }
  }, new URL('../private/notes', TEST_WEBID).href);
  expect(denied).toEqual({ webId: null, error: 'Origin not granted access' });
  await grantTestSite(context, page);

  // The test site reads window.solid.webId + window.solid.fetch(private resource).
  await expect(page.locator('#webid')).toContainText('test-pod', { timeout: 15_000 });
  await expect(page.locator('#fetch-result')).toContainText('Private Note', { timeout: 15_000 });
  await expect(page.locator('#status')).toContainText('Private resource fetched successfully');
});
