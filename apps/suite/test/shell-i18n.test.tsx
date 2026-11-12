// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { DEVICE_LOCALE_KEY } from "@jeswr/suite-i18n";
import { useLocale, useT } from "@jeswr/suite-i18n/react";
import { useDirection } from "@jeswr/suite-ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguagePicker, SuiteI18nProvider, useLanguageChoice } from "../src/shell/i18n";
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
  // Each account's explicit choice is mirrored to the device, so signing out keeps the last one.
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("fr");
  account.id = null;
  view.rerender(<Harness />);
  expect(document.documentElement.lang).toBe("fr");
  localStorage.removeItem(DEVICE_LOCALE_KEY);
  fireEvent(window, new StorageEvent("storage", { key: DEVICE_LOCALE_KEY }));
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

function Direction() {
  return <output data-testid="direction">{useDirection()}</output>;
}
function SignedOut() {
  return (
    <PreferencesProvider>
      <SuiteI18nProvider>
        <Copy />
        <Direction />
        <LanguagePicker />
      </SuiteI18nProvider>
    </PreferencesProvider>
  );
}
it("applies a language picked while signed out, before any account or while it restores", () => {
  account.id = null;
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["ar-EG"]);
  const view = render(<SignedOut />);
  expect(document.documentElement.dir).toBe("rtl");
  expect(screen.getByTestId("direction").textContent).toBe("rtl");
  fireEvent.change(screen.getByRole("combobox", { name: "اللغة" }), { target: { value: "en" } });
  expect(screen.getByTestId("copy").textContent).toBe("en: Home");
  expect(document.documentElement.dir).toBe("ltr");
  expect(screen.getByTestId("direction").textContent).toBe("ltr");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("en");
  expect(localStorage.getItem(preferencesKey("first"))).toBeNull();
  // A reload paints the device choice even while the session is still restoring.
  view.unmount();
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByRole("combobox", { name: "Language" })).toHaveProperty("value", "en");
});
it("lets an account's explicit choice win once loaded, and keeps the device choice for automatic", () => {
  localStorage.setItem(DEVICE_LOCALE_KEY, "es");
  account.id = null;
  const view = render(<SignedOut />);
  expect(document.documentElement.lang).toBe("es");
  localStorage.setItem(preferencesKey("first"), JSON.stringify({ locale: "ar" }));
  account.id = "first";
  view.rerender(<SignedOut />);
  expect(document.documentElement.lang).toBe("ar");
  expect(screen.getByTestId("direction").textContent).toBe("rtl");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("ar");
  account.id = "second";
  view.rerender(<SignedOut />);
  expect(document.documentElement.lang).toBe("ar");
  fireEvent.change(screen.getByRole("combobox", { name: "اللغة" }), { target: { value: "de" } });
  expect(parsePreferences(localStorage.getItem(preferencesKey("second"))).locale).toBe("de");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("de");
  fireEvent.change(screen.getByRole("combobox", { name: "Sprache" }), { target: { value: "" } });
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
  expect(document.documentElement.lang).toBe("en");
});
it("requires the provider for the picker binding", () => {
  function Orphan() {
    useLanguageChoice();
    return null;
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Orphan />)).toThrow("useLanguageChoice requires SuiteI18nProvider");
});
