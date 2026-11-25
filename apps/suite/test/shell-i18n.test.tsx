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
  // The active account's choice is mirrored for the pre-hydration boot script.
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("fr");
  // Signing out leaves nothing of the last account's choice behind.
  account.id = null;
  view.rerender(<Harness />);
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
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
it("lets an account's explicit choice win once loaded, and never lends it to another account", () => {
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
  // A second account that never chose follows the browser, not the first account's Arabic.
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "de" } });
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
it("never writes the device key back in reaction to another tab's write", () => {
  localStorage.setItem(preferencesKey("first"), JSON.stringify({ locale: "de" }));
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("de");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("de");
  // Another tab, signed in as an account that prefers French, mirrors its choice.
  localStorage.setItem(DEVICE_LOCALE_KEY, "fr");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  fireEvent(window, new StorageEvent("storage", { key: DEVICE_LOCALE_KEY }));
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(document.documentElement.lang).toBe("de");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("fr");
});
it("stores Automatic per account, so it follows the browser rather than another account's choice", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-PT"]);
  const view = render(<SignedOut />);
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma" }), { target: { value: "" } });
  expect(parsePreferences(localStorage.getItem(preferencesKey("first"))).locale).toBe("auto");
  expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveProperty("value", "");
  // Another account (or tab) leaves a device choice behind; "auto" still follows the browser.
  localStorage.setItem(DEVICE_LOCALE_KEY, "ar");
  fireEvent(window, new StorageEvent("storage", { key: DEVICE_LOCALE_KEY }));
  expect(document.documentElement.lang).toBe("pt");
  view.unmount();
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("pt");
  // Loading an Automatic account mirrors it: the device follows the browser too.
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
  // An account that never chose does not inherit the device's (or another account's) choice.
  localStorage.setItem(DEVICE_LOCALE_KEY, "ar");
  account.id = "second";
  cleanup();
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("pt");
  expect(document.documentElement.dir).toBe("ltr");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
});
it("does not apply one account's language choice to another account", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-PT"]);
  localStorage.setItem(preferencesKey("first"), JSON.stringify({ locale: "fr" }));
  const view = render(<SignedOut />);
  expect(document.documentElement.lang).toBe("fr");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("fr");
  account.id = "second"; // never chose a language
  view.rerender(<SignedOut />);
  expect(screen.getByTestId("copy").textContent).toBe("pt: Início");
  expect(document.documentElement.lang).toBe("pt");
  // The device mirror is overwritten with the new active account's resolved choice.
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
  account.id = "first";
  view.rerender(<SignedOut />);
  expect(document.documentElement.lang).toBe("fr");
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("fr");
});
it("ignores another tab's device-key change while an account is active", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-PT"]);
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("pt");
  // Another tab, signed in as an account that chose French, mirrors its choice.
  localStorage.setItem(DEVICE_LOCALE_KEY, "fr");
  fireEvent(window, new StorageEvent("storage", { key: DEVICE_LOCALE_KEY, newValue: "fr" }));
  fireEvent(window, new StorageEvent("storage", { key: null }));
  expect(document.documentElement.lang).toBe("pt");
  expect(screen.getByTestId("copy").textContent).toBe("pt: Início");
});
it("still follows the device key across tabs while signed out", () => {
  account.id = null;
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("en");
  localStorage.setItem(DEVICE_LOCALE_KEY, "de");
  fireEvent(window, new StorageEvent("storage", { key: DEVICE_LOCALE_KEY }));
  expect(document.documentElement.lang).toBe("de");
});
it("clears the device key when signing out of all accounts", () => {
  localStorage.setItem(preferencesKey("first"), JSON.stringify({ locale: "ar" }));
  const view = render(<SignedOut />);
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  account.id = null;
  view.rerender(<SignedOut />);
  expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
  expect(document.documentElement.lang).toBe("en");
  expect(document.documentElement.dir).toBe("ltr");
  expect(screen.getByTestId("direction").textContent).toBe("ltr");
});
it("copes with browsers that have no navigator.languages", () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(undefined as never);
  vi.spyOn(navigator, "language", "get").mockReturnValue("de-AT");
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("de");
  cleanup();
  vi.spyOn(navigator, "language", "get").mockReturnValue(undefined as never);
  render(<SignedOut />);
  expect(document.documentElement.lang).toBe("en");
});
it("gives the language help text a per-instance id", () => {
  render(
    <>
      <Harness />
      <Harness />
    </>,
  );
  const selects = screen.getAllByRole("combobox", { name: "Language" });
  const ids = selects.map((select) => select.getAttribute("aria-describedby"));
  expect(new Set(ids).size).toBe(2);
  for (const id of ids)
    expect(document.getElementById(id as string)?.textContent).toBe(
      "Choose the language used across Solid Suite.",
    );
});
