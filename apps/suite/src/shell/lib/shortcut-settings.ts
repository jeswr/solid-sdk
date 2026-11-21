// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/**
 * WCAG 2.1.4 (character key shortcuts): one suite-wide switch for single-key
 * shortcuts. Apps that bind their own single keys (Home 1–9, Drive c, …) call
 * `characterShortcutsEnabled()` before acting; Cmd/Ctrl shortcuts are unaffected.
 */
export const SHORTCUTS_SETTING_KEY = "suite.settings.shortcuts";
export const SHORTCUTS_SETTING_EVENT = "suite:shortcuts-setting";

/** The choice made on this page when storage refused it; it wins until a write succeeds. */
let unsaved: boolean | undefined;

export function characterShortcutsEnabled(storage?: Pick<Storage, "getItem">): boolean {
  if (unsaved !== undefined) return unsaved;
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
    unsaved = undefined;
  } catch {
    // Memory-only for this page, so re-reading storage cannot undo the person's choice.
    unsaved = on;
  }
  (target ?? globalThis).dispatchEvent?.(new Event(SHORTCUTS_SETTING_EVENT));
}

/** Shared history commands are listed in the shortcuts settings and help sheet. */
export const UNDO_SHORTCUTS = {
  undo: { id: "global.undo", keys: "Cmd/Ctrl+Z", label: "Undo latest change", group: "Global" },
  redo: {
    id: "global.redo",
    keys: "Cmd/Ctrl+Shift+Z",
    label: "Redo latest change",
    group: "Global",
  },
} as const;
