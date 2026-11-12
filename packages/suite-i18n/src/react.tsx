// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from "react";
import { catalogs, en } from "./index.js";
import { createI18n, type I18n, type I18nOptions } from "./translator.js";
import type { Catalog, Translator } from "./types.js";

export interface I18nProviderProps {
  locale: string;
  children: ReactNode;
}
export interface I18nBindings<C extends Catalog> {
  I18nProvider: (props: I18nProviderProps) => ReactElement;
  useT: () => Translator<C>;
  useLocale: () => string;
  useFormatters: () => I18n<C>;
}

/** Create typed bindings for an app's own English source catalog. No provider means English. */
export function createI18nReact<const C extends Catalog>(
  options: Omit<I18nOptions<C>, "locale">,
): I18nBindings<C> {
  const Context = createContext(createI18n(options));
  function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
    const value = useMemo(() => createI18n({ ...options, locale }), [locale]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }
  return {
    I18nProvider,
    useT: () => useContext(Context).t,
    useLocale: () => useContext(Context).locale,
    useFormatters: () => useContext(Context),
  };
}
const suite = createI18nReact({ english: en, catalogs });
export const I18nProvider: I18nBindings<typeof en>["I18nProvider"] = suite.I18nProvider;
export const useT: I18nBindings<typeof en>["useT"] = suite.useT;
export const useLocale: I18nBindings<typeof en>["useLocale"] = suite.useLocale;
export const useFormatters: I18nBindings<typeof en>["useFormatters"] = suite.useFormatters;
