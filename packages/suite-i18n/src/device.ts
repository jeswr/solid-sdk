// AUTHORED-BY Claude Opus 5.5
import { type Locale, locales, rtlLanguages } from "./locale.js";

/** The device-level language choice, used before an account's preferences are known. */
export const DEVICE_LOCALE_KEY = "suite.locale.v1";

const isLocale = (value: unknown): value is Locale =>
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
 * Source for an inline script, run before hydration, that sets `<html lang dir>` from the
 * device choice or browser languages so a right-to-left page never paints left to right.
 * It is a constant for a given key, so a CSP hash computed at build time keeps matching.
 */
export function localeBootScript(key: string = DEVICE_LOCALE_KEY): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return [
    "(function(){try{",
    `var s=${json(locales)},r=${json(rtlLanguages)},p=[],l="en",i,t;`,
    `try{p.push(localStorage.getItem(${json(key)}))}catch(e){}`,
    "p=p.concat(navigator.languages||[navigator.language]);",
    'for(i=0;i<p.length;i++){t=String(p[i]||"").toLowerCase().split("-")[0];',
    "if(s.indexOf(t)>=0){l=t;break}}",
    'var d=document.documentElement;d.lang=l;d.dir=r.indexOf(l)>=0?"rtl":"ltr"',
    "}catch(e){}})()",
  ].join("");
}
