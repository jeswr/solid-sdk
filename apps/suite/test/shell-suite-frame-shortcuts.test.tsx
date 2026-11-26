// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { act, h, key, mount } from "./drive-ui-dom";

vi.mock("next/navigation", () => ({
  usePathname: () => "/drive",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/welcome/walkthrough", () => ({ WalkthroughDock: () => null }));

const { SuiteFrame } = await import("../src/components/interim-shell/suite-frame");
const { SHORTCUTS_SETTING_KEY, setCharacterShortcutsEnabled } = await import(
  "../src/shell/lib/shortcut-settings"
);

beforeEach(() => localStorage.clear());

it.each([
  "drive",
  "docs",
] as const)("keeps %s search shortcuts enabled by default and follows the shared setting without a registry", async (app) => {
  await mount(
    h(SuiteFrame, {
      app,
      sidebar: null,
      search: { placeholder: "Search", action: `/${app}/search`, scopeLabel: `in ${app}` },
      children: null,
    }),
  );
  const main = document.getElementById("main-content") as HTMLElement;
  const search = document.querySelector<HTMLInputElement>("[data-global-search]");
  await act(() => main.focus());
  await key(main, "/");
  expect(document.activeElement).toBe(search);

  await act(() => {
    main.focus();
    setCharacterShortcutsEnabled(false, localStorage, window);
  });
  await key(main, "/");
  expect(document.activeElement).toBe(main);

  // A saved change from another tab also takes effect without remounting.
  localStorage.setItem(SHORTCUTS_SETTING_KEY, "on");
  await act(() => window.dispatchEvent(new Event("storage")));
  await key(main, "/");
  expect(document.activeElement).toBe(search);
});
