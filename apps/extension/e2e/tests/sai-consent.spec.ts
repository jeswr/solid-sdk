// AUTHORED-BY Claude Opus 5.5
import { expect, test } from '../fixtures';
import { clickClosingControl, performLogin, SAI_WEBID } from './helpers';

const CONTACTS = 'http://localhost:3000/sai-pod/registries/data/contacts/';
const INDIVIDUAL = 'http://www.w3.org/2006/vcard/ns#Individual';

test('offers an SAI data registration with no Type Index entry and pins only that container', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId, SAI_WEBID, 'sai@example.com');
  const site = await context.newPage();
  await site.goto('http://localhost:8080');
  await site.waitForFunction(
    () =>
      typeof (window as unknown as { solid?: { requestAccess?: unknown } }).solid?.requestAccess ===
      'function',
  );
  await site.evaluate((classIRI) => {
    const button = document.createElement('button');
    button.textContent = 'Request contacts';
    button.addEventListener('click', () => {
      const solid = (
        window as unknown as {
          solid: { requestAccess(request: unknown): Promise<{ ok: boolean; grants?: unknown }> };
        }
      ).solid;
      void solid
        .requestAccess({ classes: [classIRI], modes: ['read'], duration: 'P1D' })
        .then((result) => {
          button.dataset.result = JSON.stringify(result);
        });
    });
    document.body.appendChild(button);
  }, INDIVIDUAL);

  const consentPromise = context.waitForEvent('page');
  await site.getByRole('button', { name: 'Request contacts' }).click();
  const consent = await consentPromise;
  await consent.waitForURL('**/consent/consent.html?*');
  const card = consent.locator('article.class-item');
  await expect(card.locator('.target-group')).toHaveText(['From your data registries']);
  // Its members conform to the class, so it starts selected and the list starts closed.
  await card.getByText('See included items').click();
  const target = card.getByRole('checkbox', { name: `${CONTACTS} (folder and its contents)` });
  await expect(target).toBeChecked();
  await expect(card.locator('[data-target-id]')).toHaveCount(1);
  await expect(card.locator('.target-hint')).toHaveCount(0);
  await target.uncheck();
  await expect(consent.getByRole('button', { name: 'Share', exact: true })).toBeDisabled();
  await target.check();
  await expect(consent.locator('#selection-hint')).toHaveText(
    '1 item selected. Only checked items will be shared.',
  );
  await clickClosingControl(consent, consent.getByRole('button', { name: 'Share', exact: true }));

  const button = site.getByRole('button', { name: 'Request contacts' });
  await expect(button).toHaveAttribute('data-result', /.+/);
  const result = JSON.parse((await button.getAttribute('data-result')) ?? '{}');
  expect(result.ok).toBe(true);
  expect(result.grants).toMatchObject([
    { dataClass: INDIVIDUAL, targets: [{ url: CONTACTS, kind: 'container' }] },
  ]);

  const statuses = await site.evaluate(
    async (urls) => {
      const solid = (window as unknown as { solid: { fetch(url: string): Promise<Response> } })
        .solid;
      return Promise.all(
        urls.map((url) =>
          solid.fetch(url).then(
            async (response) => `${response.status} ${await response.text()}`,
            (error: Error) => `denied ${error.message}`,
          ),
        ),
      );
    },
    [`${CONTACTS}ada`, 'http://localhost:3000/sai-pod/private/notes'],
  );
  expect(statuses[0]).toMatch(/^200 [\s\S]*Ada Registry/);
  expect(statuses[1]).toBe('denied Out of grant scope');
});
