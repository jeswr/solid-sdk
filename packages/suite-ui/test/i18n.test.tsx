// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { I18nProvider } from "@jeswr/suite-i18n/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  AppLauncher,
  AppRail,
  BottomTabBar,
  defaultRailPins,
  RailPreferencesProvider,
  suiteApps,
} from "../src/index.js";
import { SignInCard } from "../src/sign-in/sign-in-card.js";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <RailPreferencesProvider
      value={{
        value: { pinned: defaultRailPins },
        update: () => {},
        retry: () => {},
        status: "ready",
      }}
    >
      {children}
    </RailPreferencesProvider>
  );
}
beforeEach(() => {
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
  fireEvent.click(screen.getByRole("button", { name: "Apps" }));
  expect(screen.getByRole("link", { name: "Accueil" })).toBeTruthy();
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
