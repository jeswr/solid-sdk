// AUTHORED-BY Claude Opus 5.5
/**
 * WCAG 2.1.4 (character key shortcuts): one suite-wide switch for single-key
 * shortcuts. Apps that bind their own single keys (Home 1–9, Drive c, …) call
 * `characterShortcutsEnabled()` before acting; Cmd/Ctrl shortcuts are unaffected.
 */
export const SHORTCUTS_SETTING_KEY = "suite.settings.shortcuts";
export const SHORTCUTS_SETTING_EVENT = "suite:shortcuts-setting";

export function characterShortcutsEnabled(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? localStorage).getItem(SHORTCUTS_SETTING_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setCharacterShortcutsEnabled(
  on: boolean,
  storage?: Pick<Storage, "setItem">,
  target?: Pick<EventTarget, "dispatchEvent">,
): void {
  try {
    (storage ?? localStorage).setItem(SHORTCUTS_SETTING_KEY, on ? "on" : "off");
  } catch {
    /* Memory-only for this page. */
  }
  (target ?? globalThis).dispatchEvent?.(new Event(SHORTCUTS_SETTING_EVENT));
}
