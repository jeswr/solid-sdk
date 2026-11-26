// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { I18nProvider } from "@jeswr/suite-i18n/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  AppLauncher,
  AppRail,
  BottomTabBar,
  DirectionProvider,
  defaultRailPins,
  type RailPreferencesBinding,
  RailPreferencesProvider,
  suiteApps,
  useDirection,
} from "../src/index.js";
import { TopBar } from "../src/shell/top-bar.js";
import { SignInCard } from "../src/sign-in/sign-in-card.js";

let rail: Partial<RailPreferencesBinding> = {};
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <RailPreferencesProvider
      value={{
        value: { pinned: defaultRailPins },
        update: () => {},
        retry: () => {},
        status: "ready",
        ...rail,
      }}
    >
      {children}
    </RailPreferencesProvider>
  );
}
beforeEach(() => {
  rail = {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
it("translates built-in rail, launcher and mobile app names through the shared provider", () => {
  const view = render(
    <I18nProvider locale="es">
      <AppRail currentApp="home" />
      <BottomTabBar currentApp="home" />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  expect(screen.getAllByRole("link", { name: "Inicio" })).toHaveLength(2);
  view.rerender(
    <I18nProvider locale="fr">
      <AppLauncher currentApp="home" />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Applications" }));
  expect(screen.getByRole("link", { name: "Accueil" })).toBeTruthy();
});
it("translates the launcher, customise panel and navigation landmarks", () => {
  const view = render(
    <I18nProvider locale="fr">
      <AppRail currentApp="home" />
      <BottomTabBar currentApp="home" />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  expect(screen.getAllByRole("navigation", { name: "Applications" })).toHaveLength(2);
  expect(
    screen
      .getAllByRole("button", { name: "Plus d'applications" })
      .map((button) => button.textContent),
  ).toContain("Plus");
  view.unmount();
  render(
    <I18nProvider locale="fr">
      <AppLauncher currentApp="home" />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  fireEvent.click(screen.getByRole("button", { name: "Applications" }));
  const dialog = screen.getByRole("dialog", { name: "Applications" });
  expect(within(dialog).getByRole("heading", { name: "Applications" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Fermer les applications" })).toBeTruthy();
  expect(within(dialog).getByRole("searchbox", { name: "Filtrer les applications" })).toBeTruthy();
  expect(within(dialog).getByRole("grid", { name: "Applications disponibles" })).toBeTruthy();
  // Every built-in app is admitted now that none is in the backlog.
  expect(within(dialog).getByText(`${suiteApps.length} applications trouvées`)).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "zz" } });
  expect(within(dialog).getByText("Aucun résultat pour « zz »")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Effacer les filtres" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Personnaliser la barre" }));
  const panel = screen.getByRole("region", { name: "Personnaliser la barre" });
  expect(within(panel).getByText("5 applications épinglées sur 6")).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Monter Fichiers" })).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Descendre Fichiers" })).toBeTruthy();
  expect(
    within(panel).getByRole("button", {
      name: "Faire glisser Accueil pour l'épingler ou le déplacer",
    }),
  ).toBeTruthy();
});
it("translates loading, empty and error states with Arabic plurals", () => {
  rail = { status: "loading" };
  const view = render(
    <I18nProvider locale="ar">
      <AppRail currentApp="home" />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  expect(screen.getByRole("status", { name: "جارٍ تحميل التطبيقات المثبتة" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "التطبيقات" }));
  expect(screen.getByRole("status", { name: "جارٍ تحميل التطبيقات" })).toBeTruthy();
  view.unmount();
  rail = { error: "offline" };
  render(
    <I18nProvider locale="es">
      <AppLauncher currentApp="home" />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  fireEvent.click(screen.getByRole("button", { name: "Aplicaciones" }));
  expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
});
it("shows the empty-rail prompt and singular counts in the active language", () => {
  rail = { value: { pinned: [] } };
  render(
    <I18nProvider locale="de">
      <AppLauncher currentApp="home" apps={suiteApps.slice(0, 1)} />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  fireEvent.click(screen.getByRole("button", { name: "Apps" }));
  expect(screen.getByText("Noch keine Apps angeheftet")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apps auswählen" })).toBeTruthy();
  expect(screen.getByText("1 App gefunden")).toBeTruthy();
});
it("re-exports Radix's direction context and swaps grid arrows in RTL", () => {
  function Probe() {
    return <output>{useDirection()}</output>;
  }
  const view = render(<Probe />);
  expect(screen.getByRole("status").textContent).toBe("ltr");
  view.rerender(
    <DirectionProvider dir="rtl">
      <Probe />
    </DirectionProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("rtl");
  view.unmount();
  render(
    <DirectionProvider dir="rtl">
      <AppLauncher currentApp="home" />
    </DirectionProvider>,
    { wrapper: Wrapper },
  );
  fireEvent.click(screen.getByRole("button", { name: "Apps" }));
  const grid = screen.getByRole("grid", { name: "Available apps" });
  const link = (name: string) => within(grid).getByRole("link", { name });
  link("Home").focus();
  fireEvent.keyDown(link("Home"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(link("Drive"));
  fireEvent.keyDown(link("Drive"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(link("Home"));
});
it("lays out the shell, rail and sign-in card with logical properties only", () => {
  for (const file of ["shell", "navigation", "sign-in"]) {
    const css = readFileSync(`src/styles/${file}.css`, "utf8");
    expect(
      css.match(
        /(?:^|[\s;{])(?:left|right|(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?):|text-align:\s*(?:left|right)/gm,
      ),
      file,
    ).toBeNull();
  }
  expect(readFileSync("src/styles/components.css", "utf8")).toMatch(
    /\[dir="rtl"\] \.suite-rtl-mirror \{\s*transform: scaleX\(-1\)/,
  );
  expect(readFileSync("src/styles/sign-in.css", "utf8")).toMatch(
    /\[dir="rtl"\] \.su-sign-in-back svg \{\s*transform: scaleX\(-1\)/,
  );
});
it("preserves a host's explicit navigation labels", () => {
  render(
    <I18nProvider locale="es">
      <AppRail
        currentApp="home"
        apps={suiteApps.map((app) =>
          app.slug === "home" ? { ...app, name: "My workspace" } : app,
        )}
      />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  expect(screen.getByRole("link", { name: "My workspace" })).toBeTruthy();
});
it("translates sign-in controls and help while preserving host titles", () => {
  render(
    <I18nProvider locale="es">
      <SignInCard
        title="Host title"
        providers={[]}
        onWebId={() => {}}
        onProvider={() => {}}
        onCustomProvider={() => {}}
        onAccount={() => {}}
      />
    </I18nProvider>,
    { wrapper: Wrapper },
  );
  expect(screen.getByRole("heading", { name: "Host title" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "¿Qué es un WebID?" }));
  expect(screen.getByRole("heading", { name: "¿Qué es un WebID?" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
});

it("translates the top bar's refresh status and mirrors breadcrumb separators", () => {
  const { container } = render(
    <I18nProvider locale="ar">
      <TopBar appName="Docs" refreshing />
    </I18nProvider>,
  );
  expect(screen.getByRole("status", { name: "جارٍ تحديث المحتوى" })).toBeTruthy();
  expect(container.textContent).toContain("جارٍ تحديث المحتوى");
  for (const file of ["breadcrumbs.tsx", "ui/breadcrumb.tsx"])
    expect(readFileSync(`src/components/${file}`, "utf8")).not.toMatch(
      /<ChevronRight(?![^>]*suite-rtl-mirror)[^>]*\/>/,
    );
});
