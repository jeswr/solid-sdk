// AUTHORED-BY Claude Opus 4.8
//
// theme-script.ts — the no-flash theme bootstrap, as a plain string with NO
// React imports, so the SERVER-side app/layout.tsx can inject it in <head>
// without importing the @jeswr/app-shell barrel. (Importing the barrel from a
// server component pulls its client-only React.createContext into the RSC graph
// and breaks `next build` page-data collection — see the note in layout.tsx.)
//
// This is intentionally IDENTICAL to `themeScript()` from @jeswr/app-shell with
// its default arguments — the storageKey "app-shell-theme" and the dark class
// "dark", which are exactly the <ThemeProvider> defaults this template uses. If
// you customise the ThemeProvider's storageKey/attributeClass in
// app/providers.tsx, update the two literals here to match, or the pre-paint
// class and the React state will disagree.
//
// What it does, before first paint: read the persisted preference; treat
// "dark" — or "system"/none + an OS dark preference — as dark; toggle the `.dark`
// class + `color-scheme` on <html>. Wrapped in try/catch so a blocked
// localStorage never throws during the critical bootstrap.

const STORAGE_KEY = "app-shell-theme";
const DARK_CLASS = "dark";

export const NO_FLASH_THEME_SCRIPT: string =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});` +
  `var d=t==="dark"||((t===null||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);` +
  `var r=document.documentElement;r.classList.toggle(${JSON.stringify(DARK_CLASS)},d);` +
  `r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
