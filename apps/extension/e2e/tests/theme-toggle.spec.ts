// AUTHORED-BY GPT-6.1-Sol (Codex)
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../fixtures';

test('side panel theme toggle keeps its visible label at the start of its accessible name', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  const button = panel.locator('jeswr-theme-toggle').getByRole('button');

  for (const label of ['System', 'Light', 'Dark', 'System']) {
    await expect(button).toHaveText(label);
    await expect(button).toHaveAccessibleName(new RegExp(`^${label}\\b`));
    const { violations, passes } = await new AxeBuilder({ page: panel })
      .include('jeswr-theme-toggle')
      .withRules(['label-content-name-mismatch'])
      .analyze();
    expect(violations).toEqual([]);
    expect(
      passes.some(({ id, nodes }) => id === 'label-content-name-mismatch' && nodes.length > 0),
    ).toBe(true);
    await button.click();
  }
});
