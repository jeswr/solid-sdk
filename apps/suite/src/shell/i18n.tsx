// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { dir, negotiateLocale } from "@jeswr/suite-i18n";
import { I18nProvider, useLocale, useT } from "@jeswr/suite-i18n/react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { usePreferences } from "./settings/preferences";

function DocumentLocale() {
  const locale = useLocale();
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir(locale);
  }, [locale]);
  return null;
}

/** English on the server and first hydration; browser negotiation happens before paint. */
export function SuiteI18nProvider({ children }: { children: ReactNode }) {
  const preference = usePreferences("locale");
  const [languages, setLanguages] = useState<readonly string[]>([]);
  useLayoutEffect(() => {
    const update = () => setLanguages(navigator.languages);
    update();
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);
  const locale = negotiateLocale(preference.value, languages);
  return (
    <I18nProvider locale={locale}>
      <DocumentLocale />
      {children}
    </I18nProvider>
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
