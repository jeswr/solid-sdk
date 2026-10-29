// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
const views = ['signed-out', 'busy', 'signed-in'] as const;

for (const surface of ['popup', 'sidepanel']) {
  describe(`${surface} account view CSS`, () => {
    for (const theme of ['light', 'dark']) {
      it.each(views)(`${theme}: only %s is displayed`, (selected) => {
        const { window } = new JSDOM(read(`../src/${surface}/${surface}.html`));
        try {
          const { document } = window;
          document.documentElement.classList.toggle('dark', theme === 'dark');
          const style = document.createElement('style');
          // Inline the real page CSS and its import. Do not rely on the optional account
          // switcher's stylesheet to enforce the page's hidden contract.
          style.textContent =
            read('../src/shared/account-surface.css') +
            read(`../src/${surface}/${surface}.css`).replace(/@import[^;]+;/g, '');
          document.head.append(style);
          for (const id of views) document.getElementById(id)!.hidden = id !== selected;

          // Checking computed display catches #busy { display: flex } overriding [hidden].
          // Checking only the hidden property would pass with the original regression.
          expect(
            views.filter((id) => {
              const display = window.getComputedStyle(document.getElementById(id)!).display;
              return display !== 'none';
            }),
          ).toEqual([selected]);
        } finally {
          window.close();
        }
      });
    }
  });
}
