// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import {
  characterShortcutsEnabled,
  SHORTCUTS_SETTING_EVENT,
  setCharacterShortcutsEnabled,
} from "../lib/shortcut-settings";
import {
  createSequenceMatcher,
  isEditableTarget,
  parseKeys,
  type ShortcutScope,
} from "../lib/shortcuts";

export interface RegisteredShortcut {
  id: string;
  keys: string;
  label: string;
  group: string;
  scope?: ShortcutScope;
}
export interface Shortcut extends RegisteredShortcut {
  run: () => void;
  when?: () => boolean;
}
type Entry = Shortcut & { token: string };
const Context = createContext<{
  shortcuts: readonly Entry[];
  register: (shortcut: Shortcut) => () => void;
  characterKeys: boolean;
  setCharacterKeys: (on: boolean) => void;
} | null>(null);

const hasPrimaryModifier = (keys: string) => /\b(cmd|ctrl|meta|alt)(\/ctrl)?\+/iu.test(keys);

/** editor > app > global; later registrations win within the same scope. */
export function ShortcutsProvider({
  children,
  platform,
}: {
  children: ReactNode;
  platform?: string;
}) {
  const [shortcuts, setShortcuts] = useState<Entry[]>([]);
  const [characterKeys, setCharacterKeysState] = useState(true);
  useEffect(() => {
    const sync = () => setCharacterKeysState(characterShortcutsEnabled());
    sync();
    addEventListener(SHORTCUTS_SETTING_EVENT, sync);
    addEventListener("storage", sync);
    return () => {
      removeEventListener(SHORTCUTS_SETTING_EVENT, sync);
      removeEventListener("storage", sync);
    };
  }, []);
  const setCharacterKeys = (on: boolean) => {
    setCharacterKeysState(on);
    setCharacterShortcutsEnabled(on);
  };
  const [register] = useState(() => {
    let serial = 0;
    return (shortcut: Shortcut) => {
      parseKeys(shortcut.keys);
      const token = `shortcut-${serial++}`;
      setShortcuts((current) => [...current, { ...shortcut, token }]);
      return () => setShortcuts((current) => current.filter((entry) => entry.token !== token));
    };
  });
  useEffect(() => {
    let signature = "";
    let matcher = createSequenceMatcher([]);
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const active = shortcuts.filter(
        (shortcut) =>
          (characterKeys || hasPrimaryModifier(shortcut.keys)) &&
          (!shortcut.when || shortcut.when()),
      );
      const nextSignature = active.map((shortcut) => shortcut.token).join(",");
      if (signature !== nextSignature) {
        signature = nextSignature;
        matcher = createSequenceMatcher(
          active.map((shortcut) => ({
            id: shortcut.token,
            keys: shortcut.keys,
            scope: shortcut.scope ?? (shortcut.group === "Global" ? "global" : "app"),
          })),
          { platform: platform ?? navigator.platform },
        );
      }
      const result = matcher.feed({
        key: event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        editable: isEditableTarget(event.target),
        now: event.timeStamp,
      });
      if (result.pending || result.matched) event.preventDefault();
      if (result.matched) active.find((shortcut) => shortcut.token === result.matched)?.run();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [shortcuts, platform, characterKeys]);
  return (
    <Context.Provider value={{ shortcuts, register, characterKeys, setCharacterKeys }}>
      {children}
    </Context.Provider>
  );
}
export function useShortcut(shortcut: Shortcut) {
  const context = useContext(Context);
  const latest = useRef(shortcut);
  latest.current = shortcut;
  const register = context?.register;
  const { id, keys, label, group, scope } = shortcut;
  useEffect(
    () =>
      register?.({
        id,
        keys,
        label,
        group,
        ...(scope ? { scope } : {}),
        run: () => latest.current.run(),
        when: () => latest.current.when?.() ?? true,
      }),
    [register, id, keys, label, group, scope],
  );
}
export function useRegisteredShortcuts(): readonly RegisteredShortcut[] {
  return useContext(Context)?.shortcuts ?? [];
}

export function useShortcutSettings(): {
  characterKeys: boolean;
  setCharacterKeys: (on: boolean) => void;
} {
  const context = useContext(Context);
  return {
    characterKeys: context?.characterKeys ?? true,
    setCharacterKeys: context?.setCharacterKeys ?? (() => {}),
  };
}
