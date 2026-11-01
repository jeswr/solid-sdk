// AUTHORED-BY Codex GPT-6.1-Sol
import axe from 'axe-core';
import { expect } from 'vitest';

/** jsdom checks names, roles and relationships; browser E2E owns layout and contrast. */
export async function expectAccessible(document: Document): Promise<void> {
  const result = await axe.run(document.documentElement, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })),
  ).toEqual([]);
}
