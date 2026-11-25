// AUTHORED-BY Claude Opus 5.5
import { type Locale, locales, rtlLanguages } from "./locale.js";

/** The device-level language choice, used before an account's preferences are known. */
export const DEVICE_LOCALE_KEY = "suite.locale.v1";

/** The one validity test for a stored device value; the boot script applies the same rule. */
export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

/** The stored device choice, or "" (follow the browser) when absent, invalid or unreadable. */
export function readDeviceLocale(key: string = DEVICE_LOCALE_KEY): Locale | "" {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return isLocale(value) ? value : "";
  } catch {
    return "";
  }
}

/** Store the device choice; "" removes it. Returns false when browser storage refuses. */
export function writeDeviceLocale(value: Locale | "", key: string = DEVICE_LOCALE_KEY): boolean {
  try {
    if (value) globalThis.localStorage.setItem(key, value);
    else globalThis.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Source for an inline script, run before hydration, that sets `<html lang dir>` so a
 * right-to-left page never paints left to right. It applies the same rules as the provider:
 * the stored device value counts only on an exact match with a supported locale (the same
 * test as `readDeviceLocale`), then each browser language is canonicalised and matched by its
 * base language like `negotiateLocale`. The provider mirrors the active account's resolved
 * choice to the device key (removing it for Automatic), so the two agree for a valid stored
 * value. The text is a constant for a given key, so a CSP hash computed at build time keeps
 * matching; no stored or runtime value is ever interpolated into it.
 */
export function localeBootScript(key: string = DEVICE_LOCALE_KEY): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return [
    "(function(){try{",
    `var s=${json(locales)},r=${json(rtlLanguages)},p=[],l="en",i,t,v;`,
    `try{v=localStorage.getItem(${json(key)})}catch(e){}`,
    'if(typeof v==="string"&&s.indexOf(v)>=0)l=v;',
    "else{p=navigator.languages||[navigator.language];",
    'for(i=0;i<p.length;i++){try{t=Intl.getCanonicalLocales(String(p[i]))[0].split("-")[0]}catch(e){continue}',
    "if(s.indexOf(t)>=0){l=t;break}}}",
    'var d=document.documentElement;d.lang=l;d.dir=r.indexOf(l)>=0?"rtl":"ltr"',
    "}catch(e){}})()",
  ].join("");
}
