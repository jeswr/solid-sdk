// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import {
  characterShortcutsEnabled,
  SHORTCUTS_SETTING_EVENT,
  SHORTCUTS_SETTING_KEY,
  setCharacterShortcutsEnabled,
} from "../src/shell/lib/shortcut-settings";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("character shortcut setting", () => {
  it("defaults to on and round-trips off/on with a change event", () => {
    const storage = memory();
    const target = new EventTarget();
    const seen = vi.fn();
    target.addEventListener(SHORTCUTS_SETTING_EVENT, seen);
    expect(characterShortcutsEnabled(storage)).toBe(true);
    setCharacterShortcutsEnabled(false, storage, target);
    expect(storage.getItem(SHORTCUTS_SETTING_KEY)).toBe("off");
    expect(characterShortcutsEnabled(storage)).toBe(false);
    setCharacterShortcutsEnabled(true, storage, target);
    expect(characterShortcutsEnabled(storage)).toBe(true);
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it("fails open to on when storage throws, and tolerates a failing write", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(characterShortcutsEnabled(broken)).toBe(true);
    expect(() => setCharacterShortcutsEnabled(false, broken, new EventTarget())).not.toThrow();
    // The unsaved choice holds for this page; re-reading storage cannot turn keys back on.
    expect(characterShortcutsEnabled(broken)).toBe(false);
    expect(characterShortcutsEnabled(memory())).toBe(false);
    // A later successful write hands the setting back to storage.
    const storage = memory();
    setCharacterShortcutsEnabled(true, storage, new EventTarget());
    expect(characterShortcutsEnabled(storage)).toBe(true);
  });
  it("uses the browser globals by default", () => {
    const storage = memory();
    vi.stubGlobal("localStorage", storage);
    const dispatch = vi.fn();
    vi.stubGlobal("dispatchEvent", dispatch);
    setCharacterShortcutsEnabled(false);
    expect(characterShortcutsEnabled()).toBe(false);
    vi.unstubAllGlobals();
  });
});
