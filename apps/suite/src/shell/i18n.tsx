// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  DEVICE_LOCALE_KEY,
  dir,
  type Locale,
  localeNames,
  locales,
  negotiateLocale,
  readDeviceLocale,
  writeDeviceLocale,
} from "@jeswr/suite-i18n";
import { I18nProvider, useLocale, useT } from "@jeswr/suite-i18n/react";
import { DirectionProvider } from "@jeswr/suite-ui";
import { Languages } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAllPreferences } from "./settings/preferences";

type Choice = Locale | "";
interface LanguageChoice {
  /** The explicit choice in effect ("" follows the browser). */
  value: Choice;
  choose(value: Choice): void;
}
const LanguageContext = createContext<LanguageChoice | null>(null);

/** `resolved` is false only for the hydration render, whose English must not undo the boot script. */
function DocumentLocale({ resolved }: { resolved: boolean }) {
  const locale = useLocale();
  useLayoutEffect(() => {
    if (!resolved) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dir(locale);
  }, [locale, resolved]);
  return null;
}

/**
 * English on the server and first hydration; the stored choice and browser languages apply
 * before paint. An account's explicit choice wins once its preferences load. Until then (signed
 * out, or while the session restores) the device-level choice applies, which mirrors the last
 * explicit choice made here, so a reload or the sign-in page paints in it straight away.
 */
export function SuiteI18nProvider({ children }: { children: ReactNode }) {
  const { preferences, ready, update } = useAllPreferences();
  const [device, setDevice] = useState<Choice>("");
  const [languages, setLanguages] = useState<readonly string[]>([]);
  const [resolved, setResolved] = useState(false);
  useLayoutEffect(() => {
    const browser = () => setLanguages(navigator.languages);
    const storage = (event: StorageEvent) => {
      if (event.key === DEVICE_LOCALE_KEY || event.key === null) setDevice(readDeviceLocale());
    };
    browser();
    setDevice(readDeviceLocale());
    setResolved(true);
    addEventListener("languagechange", browser);
    addEventListener("storage", storage);
    return () => {
      removeEventListener("languagechange", browser);
      removeEventListener("storage", storage);
    };
  }, []);
  const account = ready ? preferences.locale : "";
  // Mirror only when the account's choice changes, never in reaction to the device key: each
  // tab has its own active account, so reacting to another tab's write would ping-pong.
  const mirrored = useRef("");
  useLayoutEffect(() => {
    if (account === mirrored.current) return;
    mirrored.current = account;
    if (!account) return;
    const next = account === "auto" ? "" : account;
    writeDeviceLocale(next);
    setDevice(next);
  }, [account]);
  // "auto" follows the browser even when another account left a device choice behind.
  const value: Choice = account === "auto" ? "" : account || device;
  const choose = (next: Choice) => {
    writeDeviceLocale(next);
    setDevice(next);
    mirrored.current = next || "auto";
    // A no-op while signed out; the device choice carries over to the next sign-in.
    update("locale", next || "auto");
  };
  const locale = negotiateLocale(value, languages);
  return (
    <I18nProvider locale={locale}>
      <DirectionProvider dir={dir(locale)}>
        <LanguageContext.Provider value={{ value, choose }}>
          <DocumentLocale resolved={resolved} />
          {children}
        </LanguageContext.Provider>
      </DirectionProvider>
    </I18nProvider>
  );
}

/** The language picker's binding: the account preference, or the device choice when signed out. */
export function useLanguageChoice(): LanguageChoice {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguageChoice requires SuiteI18nProvider");
  return context;
}

export function LanguageSelect(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const t = useT();
  const language = useLanguageChoice();
  return (
    <select
      {...props}
      value={language.value}
      onChange={(event) => language.choose(event.target.value as Choice)}
    >
      <option value="">{t("settings.automatic")}</option>
      {locales.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {localeNames[locale]}
        </option>
      ))}
    </select>
  );
}

/** Compact picker for pages shown before sign-in. */
export function LanguagePicker() {
  const t = useT();
  return (
    <span className="shell-language">
      <Languages size={16} strokeWidth={1.75} aria-hidden="true" />
      <LanguageSelect aria-label={t("settings.languageLabel")} />
    </span>
  );
}

export function SkipLink() {
  const t = useT();
  return (
    <a className="skip-link" href="#main-content">
      {t("shell.skip")}
    </a>
  );
}
