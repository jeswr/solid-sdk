// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { useLocale, useT } from "@jeswr/suite-i18n/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SuiteI18nProvider } from "../src/shell/i18n";
import { parsePreferences, preferencesKey } from "../src/shell/lib/settings-preferences";
import { AppearanceSettings } from "../src/shell/settings/appearance";
import { AutosaveStatus, PreferencesProvider } from "../src/shell/settings/preferences";

const account = vi.hoisted(() => ({ id: "first" as string | null }));
vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({ active: account.id ? { id: account.id } : null }),
}));
function Copy() {
  const t = useT();
  const locale = useLocale();
  return (
    <p data-testid="copy">
      {locale}: {t("apps.home")}
    </p>
  );
}
function Harness() {
  return (
    <PreferencesProvider>
      <SuiteI18nProvider>
        <Copy />
        <AppearanceSettings />
        <AutosaveStatus />
      </SuiteI18nProvider>
    </PreferencesProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  account.id = "first";
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("switches immediately, persists via account preferences and sets html language/direction", () => {
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "es" } });
  expect(screen.getByTestId("copy").textContent).toBe("es: Inicio");
  expect(document.documentElement.lang).toBe("es");
  expect(document.documentElement.dir).toBe("ltr");
  expect(screen.getByText("Idioma y región")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Guardado");
  expect(parsePreferences(localStorage.getItem(preferencesKey("first"))).locale).toBe("es");
  view.unmount();
  render(<Harness />);
  expect(screen.getByTestId("copy").textContent).toBe("es: Inicio");
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma" }), { target: { value: "ar" } });
  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  expect(screen.getByText("اللغة والمنطقة")).toBeTruthy();
});
it("negotiates browser languages, handles languagechange and restores automatic selection", () => {
  const browser = vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR", "es"]);
  render(<Harness />);
  expect(document.documentElement.lang).toBe("pt");
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma" }), { target: { value: "es" } });
  browser.mockReturnValue(["de-DE"]);
  fireEvent(window, new Event("languagechange"));
  expect(document.documentElement.lang).toBe("es");
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma" }), { target: { value: "" } });
  expect(document.documentElement.lang).toBe("de");
});
it("isolates account choices and follows browser language while signed out", () => {
  localStorage.setItem(preferencesKey("first"), JSON.stringify({ locale: "ar" }));
  localStorage.setItem(preferencesKey("second"), JSON.stringify({ locale: "fr" }));
  const view = render(<Harness />);
  expect(document.documentElement.dir).toBe("rtl");
  account.id = "second";
  view.rerender(<Harness />);
  expect(document.documentElement.lang).toBe("fr");
  expect(document.documentElement.dir).toBe("ltr");
  account.id = null;
  view.rerender(<Harness />);
  expect(document.documentElement.lang).toBe("en");
});
it("works in memory when persistence is unavailable and rejects invalid stored locales", () => {
  expect(parsePreferences('{"locale":"invalid","theme":"dark"}')).toMatchObject({
    locale: "",
    theme: "dark",
  });
  render(<Harness />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
  expect(document.documentElement.lang).toBe("fr");
  expect(screen.getByRole("status").textContent).toContain("cette visite");
});
