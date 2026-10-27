// AUTHORED-BY Codex GPT-6.1-Sol
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { addProfile, grantOrigin, TEST_WEBID, WORK_WEBID } from './helpers';

const ORIGIN_A = 'http://localhost:8080';
const ORIGIN_B = 'http://localhost:8081';
// The same test server also listens on loopback IPv4; a different hostname is a
// third origin without another shared port or a separate server lifecycle.
const ORIGIN_C = 'http://127.0.0.1:8080';
const PERSONAL_NOTE = 'http://localhost:3000/test-pod/private/notes';
const WORK_NOTE = 'http://localhost:3000/work-pod/private/notes';

interface SolidPage extends Window {
  solid: { webId: string; fetch(url: string): Promise<Response> };
  capturedSolidFetch: (url: string) => Promise<Response>;
  stateUpdates: (string | null)[];
}

/** WebIDs from every state reply the content script delivered to this page, in order. */
function stateUpdates(page: Page) {
  return page.evaluate(() => [...(window as unknown as SolidPage).stateUpdates]);
}

async function readNote(page: Page, url: string, captured = false) {
  return page.evaluate(
    async ({ target, useCaptured }) => {
      const app = window as unknown as SolidPage;
      try {
        const response = await (useCaptured ? app.capturedSolidFetch : app.solid.fetch)(target);
        return { status: response.status, body: await response.text() };
      } catch (error) {
        return { error: (error as Error).message };
      }
    },
    { target: url, useCaptured: captured },
  );
}

/** Wait for a state reply after `from`, then require every later reply to carry `webId`. */
async function expectStateReplies(page: Page, webId: string | null, from = 0) {
  await expect.poll(async () => (await stateUpdates(page)).length).toBeGreaterThan(from);
  expect(new Set((await stateUpdates(page)).slice(from))).toEqual(new Set([webId]));
}

async function expectBoundProfile(page: Page, webId: string, note: string, marker: string) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as SolidPage).solid.webId))
    .toBe(webId);
  const result = await readNote(page, note);
  expect(result.status).toBe(200);
  expect(result.body).toContain(marker);
  expect(result.body).toContain(webId);
}

test('two origins keep their chosen profiles, an ungranted origin stays native, and revocation is scoped', async ({
  context,
  extensionId,
}) => {
  // Two real OIDC logins plus two separate consent windows on the local CSS server.
  test.setTimeout(120_000);
  // Record state replies so assertions run after the reply arrives, not against the
  // pre-reply stub every page starts with.
  await context.addInitScript(() => {
    const app = window as unknown as SolidPage;
    app.stateUpdates = [];
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (
        event.source === window &&
        data?.dir === 'to-page' &&
        data.type === 'SOLID_STATE_UPDATE'
      ) {
        app.stateUpdates.push(data.webId ?? null);
      }
    });
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await addProfile(context, popup, TEST_WEBID, 'test@example.com');
  await addProfile(context, popup, WORK_WEBID, 'work@example.com');
  await expect(popup.locator('#profile-list > li')).toHaveCount(2);
  await expect(
    popup.getByRole('button', { name: 'Set Alex Wilder as default', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  const siteA = await context.newPage();
  await siteA.goto(ORIGIN_A);
  await grantOrigin(context, siteA, {
    label: 'Alex Wilder',
    webId: TEST_WEBID,
    targetUrl: PERSONAL_NOTE,
  });
  const siteB = await context.newPage();
  await siteB.goto(ORIGIN_B);
  await grantOrigin(context, siteB, {
    label: 'Morgan Chen',
    webId: WORK_WEBID,
    targetUrl: WORK_NOTE,
  });

  // These private resources have different owner/text markers. A 200 with the wrong
  // account, or bytes accidentally reused from the other profile's cache, must fail.
  await expectBoundProfile(siteA, TEST_WEBID, PERSONAL_NOTE, 'Alex Wilder personal note');
  await expectBoundProfile(siteB, WORK_WEBID, WORK_NOTE, 'Morgan Chen work note');
  await expect(siteA.locator('#fetch-result')).toContainText('Alex Wilder personal note');
  await expect(siteB.locator('#fetch-result')).toContainText('Morgan Chen work note');
  expect(await readNote(siteA, WORK_NOTE)).toEqual({ error: 'Out of grant scope' });
  expect(await readNote(siteB, PERSONAL_NOTE)).toEqual({ error: 'Out of grant scope' });

  // Switching the default triggers a state broadcast, but must not rebind either app.
  const updatesBefore = [(await stateUpdates(siteA)).length, (await stateUpdates(siteB)).length];
  await popup.getByRole('button', { name: 'Set Morgan Chen as default', exact: true }).click();
  await expect(
    popup.getByRole('button', { name: 'Set Morgan Chen as default', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expectStateReplies(siteA, TEST_WEBID, updatesBefore[0]);
  await expectStateReplies(siteB, WORK_WEBID, updatesBefore[1]);
  await expectBoundProfile(siteA, TEST_WEBID, PERSONAL_NOTE, 'Alex Wilder personal note');
  await expectBoundProfile(siteB, WORK_WEBID, WORK_NOTE, 'Morgan Chen work note');

  const siteC = await context.newPage();
  await siteC.goto(ORIGIN_C);
  // The ungranted origin's state reply carries no identity.
  await expectStateReplies(siteC, null);
  await expect
    .poll(() =>
      siteC.evaluate(() =>
        Object.getOwnPropertyNames((window as unknown as SolidPage).solid).sort(),
      ),
    )
    .toEqual(['login', 'requestAccess']);
  expect(await siteC.evaluate(() => Function.prototype.toString.call(window.fetch))).toMatch(
    /\{\s*\[native code\]\s*\}/,
  );
  // Ordinary site requests still use the browser's fetch successfully.
  expect(
    await siteC.evaluate(async () => {
      const response = await window.fetch('/config.json');
      return { status: response.status, config: await response.json() };
    }),
  ).toEqual({ status: 200, config: { clientIdUrl: null } });

  for (const site of [siteA, siteB]) {
    await site.evaluate(() => {
      const app = window as unknown as SolidPage;
      app.capturedSolidFetch = app.solid.fetch;
    });
  }
  expect((await readNote(siteA, PERSONAL_NOTE, true)).status).toBe(200);
  expect((await readNote(siteB, WORK_NOTE, true)).status).toBe(200);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  const manager = panel.getByRole('region', { name: 'Sites with access' });
  const rowA = manager.getByRole('article', { name: ORIGIN_A, exact: true });
  const rowB = manager.getByRole('article', { name: ORIGIN_B, exact: true });
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();
  await rowA.getByRole('button', { name: 'Revoke', exact: true }).click();
  const dialog = panel.getByRole('dialog', { name: 'Revoke site access?' });
  await dialog.getByRole('button', { name: 'Revoke access', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('Access revoked');
  await expect(rowA).toHaveCount(0);
  await expect(rowB).toBeVisible();

  // This is A's first captured call after the UI confirms revocation. No reload,
  // re-consent, or new API lookup may mask a still-authorized captured function.
  expect(await readNote(siteA, PERSONAL_NOTE, true)).toEqual({
    error: 'Origin not granted access',
  });
  await expect
    .poll(() =>
      siteA.evaluate(() =>
        Object.getOwnPropertyNames((window as unknown as SolidPage).solid).sort(),
      ),
    )
    .toEqual(['login', 'requestAccess']);
  const surviving = await readNote(siteB, WORK_NOTE, true);
  expect(surviving.status).toBe(200);
  expect(surviving.body).toContain('Morgan Chen work note');
  await expectBoundProfile(siteB, WORK_WEBID, WORK_NOTE, 'Morgan Chen work note');
  expect(await readNote(siteB, PERSONAL_NOTE)).toEqual({ error: 'Out of grant scope' });

  // The ungranted origin never received an identity or the fetch API at any point.
  await expectStateReplies(siteC, null);
  expect(
    await siteC.evaluate(() =>
      Object.getOwnPropertyNames((window as unknown as SolidPage).solid).sort(),
    ),
  ).toEqual(['login', 'requestAccess']);
});
