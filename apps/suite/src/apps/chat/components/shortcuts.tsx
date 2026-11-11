// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useAppShell } from "@/shell/app-frame";
import { characterShortcutsEnabled } from "@/shell/lib/shortcut-settings";
import { isShortcutLayerTarget } from "@/shell/lib/shortcuts";
import { useRegisteredShortcuts, useShortcut } from "@/shell/shortcuts/provider";
import { useChat } from "../state/chat-context";

const searchId = "chat.search";
const conversations = 'nav[aria-label="Conversations"]';

/** Render inside AppFrame so the app binding joins the shell's shortcut provider. */
export function ChatShortcuts() {
  const { details, setDetails } = useChat();
  const router = useRouter();
  const inShell = useAppShell();
  const focusSearch = useCallback(
    (target: EventTarget | null) => {
      if (isShortcutLayerTarget(target, conversations)) return false;
      const selectors = [
        `[role="dialog"] ${conversations} [data-chat-search]`,
        '[data-chat-search="page"]',
        ...(!window.matchMedia("(max-width: 1023px)").matches
          ? [`${conversations} [data-chat-search]`]
          : []),
      ];
      const field = selectors
        .map((selector) => document.querySelector<HTMLInputElement>(selector))
        .find((input) => input && (input.checkVisibility?.() ?? input.getClientRects().length > 0));
      if (field) field.focus();
      else router.push("/chat/search");
      return true;
    },
    [router],
  );
  useShortcut({
    id: searchId,
    keys: "/",
    scope: "app",
    group: "Chat",
    label: "Focus chat search",
    when: () => !isShortcutLayerTarget(document.activeElement, conversations),
    run: () => focusSearch(document.activeElement),
  });
  // Our registered binding also detects standalone hosts with a ShortcutsProvider.
  const registered = useRegisteredShortcuts().some((shortcut) => shortcut.id === searchId);
  useEffect(() => {
    if (inShell) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isShortcutLayerTarget(event.target, conversations) ||
        !characterShortcutsEnabled()
      )
        return;
      if (event.key === "/" && !registered && focusSearch(event.target)) event.preventDefault();
      if (event.key === "]") {
        event.preventDefault();
        setDetails(!details);
      }
    };
    addEventListener("keydown", shortcut);
    return () => removeEventListener("keydown", shortcut);
  }, [inShell, registered, details, setDetails, focusSearch]);
  return null;
}
