// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, within } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");

vi.mock("next/navigation", () => ({
  usePathname: () => "/drive",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/welcome/walkthrough", () => ({ WalkthroughDock: () => null }));

import { AppLauncher, defaultRailPins, RailPreferencesProvider } from "@jeswr/suite-ui";
import { NavigationFixture } from "../src/app/dev/components/navigation-fixture";
import { SuiteFrame } from "../src/components/interim-shell/suite-frame";
import { SuiteEnvironmentContext } from "../src/shell/environment";
import { parseSuiteEnv } from "../src/shell/lib/env";
import { visibleApps } from "../src/shell/registry";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllEnvs();
});

it.each([
  { target: "web", flag: "0" },
  { target: "web", flag: "1" },
  { target: "native", flag: "0" },
  { target: "native", flag: "1" },
])("the $target launcher and rail list the same apps with backlog flag $flag", async ({
  target,
  flag,
}) => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", target);
  vi.stubEnv("NEXT_PUBLIC_SHOW_BACKLOG_APPS", flag);
  const env = parseSuiteEnv({ NEXT_PUBLIC_SHOW_BACKLOG_APPS: flag });
  const apps = visibleApps(env.NEXT_PUBLIC_SHOW_BACKLOG_APPS);
  render(
    h(SuiteEnvironmentContext.Provider, {
      value: env,
      children: h(SuiteFrame, {
        app: "drive",
        sidebar: null,
        children: h(RailPreferencesProvider, {
          value: {
            value: { pinned: defaultRailPins },
            update: vi.fn(),
            status: "ready",
            retry: vi.fn(),
          },
          children: h(AppLauncher, {
            currentApp: "drive",
            apps,
            showBacklog: env.NEXT_PUBLIC_SHOW_BACKLOG_APPS,
          }),
        }),
      }),
    }),
  );
  const railApps = Array.from(document.querySelectorAll(".ish-rail li a"), (link) => ({
    name: link.textContent,
    href: link.getAttribute("href"),
  }));
  fireEvent.click(screen.getByRole("button", { name: "Apps" }));
  const launcher = await screen.findByRole("dialog", { name: "Apps" });
  const links = within(launcher).getAllByRole("link", { hidden: true });
  expect(
    links.map((link) => ({ name: link.textContent, href: link.getAttribute("href") })),
  ).toEqual(railApps);
  expect(links.map((link) => link.textContent)).toEqual(
    expect.arrayContaining(["Calendar", "Chat", "Agent"]),
  );
  fireEvent.change(within(launcher).getByRole("searchbox"), { target: { value: "Docs" } });
  expect(within(launcher).getAllByRole("link")).toHaveLength(1);
  expect(within(launcher).getByRole("link", { name: "Docs" }).getAttribute("href")).toBe("/docs");
});

it("the dev launcher fixture uses the same visible registry", async () => {
  render(h(NavigationFixture, { component: "AppLauncher" }));
  fireEvent.click(screen.getByRole("button", { name: "Apps" }));
  const launcher = await screen.findByRole("dialog", { name: "Apps" });
  expect(
    within(launcher)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
  ).toEqual(visibleApps(false).map((app) => app.basePath));
  expect(within(launcher).getByRole("link", { name: "Calendar" })).toBeTruthy();
  expect(within(launcher).getByRole("link", { name: "Chat" })).toBeTruthy();
});
