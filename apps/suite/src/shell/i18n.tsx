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
import { useAccounts } from "./session/accounts-provider";
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
 * before paint. A signed-in account's own preference is the only thing that decides its
 * language: an explicit choice wins, and an account that never chose (or chose Automatic)
 * follows the browser, never another account's choice. The device key is the signed-out and
 * pre-hydration default only. It mirrors the active account's resolved choice (removed for
 * Automatic), is rewritten on every account switch, is ignored by cross-tab events while an
 * account is active, and is cleared when the last account signs out.
 */
export function SuiteI18nProvider({ children }: { children: ReactNode }) {
  const { preferences, ready, update } = useAllPreferences();
  const accountId = useAccounts().active?.id ?? "";
  const [device, setDevice] = useState<Choice>("");
  const [languages, setLanguages] = useState<readonly string[]>([]);
  const [resolved, setResolved] = useState(false);
  const signedIn = useRef(false);
  signedIn.current = Boolean(accountId);
  useLayoutEffect(() => {
    const browser = () =>
      setLanguages(navigator.languages ?? (navigator.language ? [navigator.language] : []));
    const storage = (event: StorageEvent) => {
      // Each tab has its own active account; another tab's key is never this account's choice.
      if (signedIn.current) return;
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
  const account = ready && accountId ? preferences.locale : null;
  // "" (never chose) and "auto" both follow the browser.
  const accountChoice: Choice = account === null || account === "auto" ? "" : account;
  // Mirror only when the account or its choice changes, never in reaction to the device key:
  // each tab has its own active account, so reacting to another tab's write would ping-pong.
  const mirrored = useRef("");
  useLayoutEffect(() => {
    if (account === null) return;
    const tag = `${accountId}\n${account}`;
    if (tag === mirrored.current) return;
    mirrored.current = tag;
    writeDeviceLocale(accountChoice);
    setDevice(accountChoice);
  }, [account, accountChoice, accountId]);
  // Signing out of the last account must not leave its choice for the next person.
  const previousAccount = useRef("");
  useLayoutEffect(() => {
    if (previousAccount.current && !accountId) {
      mirrored.current = "";
      writeDeviceLocale("");
      setDevice("");
    }
    previousAccount.current = accountId;
  }, [accountId]);
  const value: Choice = account === null ? device : accountChoice;
  const choose = (next: Choice) => {
    writeDeviceLocale(next);
    setDevice(next);
    mirrored.current = `${accountId}\n${next || "auto"}`;
    // A no-op while signed out; the device choice only applies until an account loads.
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
