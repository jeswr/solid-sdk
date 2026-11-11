// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useAppShell } from "@/shell/app-frame";
import { characterShortcutsEnabled } from "@/shell/lib/shortcut-settings";
import { isEditableTarget } from "@/shell/lib/shortcuts";
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
      if (isEditableTarget(target)) return false;
      if (target instanceof Element) {
        if (target.closest('[role="alertdialog"],[role="menu"],[role="listbox"]')) return false;
        const dialog = target.closest('dialog,[role="dialog"]');
        // The navigation drawer owns a search field; other dialogs keep their keys.
        if (dialog && !dialog.querySelector(conversations)) return false;
      }
      const field =
        document.querySelector<HTMLInputElement>(
          `[role="dialog"] ${conversations} [data-chat-search]`,
        ) ?? document.querySelector<HTMLInputElement>('[data-chat-search="page"]');
      if (field) field.focus();
      else if (window.matchMedia("(max-width: 1023px)").matches) router.push("/chat/search");
      else {
        const sidebar = document.querySelector<HTMLInputElement>(
          `${conversations} [data-chat-search]`,
        );
        if (!sidebar) return false;
        sidebar.focus();
      }
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
    // Keep the binding ahead of global search even when a dialog owns the key.
    run: () => focusSearch(document.activeElement),
  });
  // Our registered binding also detects standalone hosts with a ShortcutsProvider.
  const registered = useRegisteredShortcuts().some((shortcut) => shortcut.id === searchId);
  useEffect(() => {
    if (inShell || registered) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        !characterShortcutsEnabled()
      )
        return;
      if (event.key === "/" && focusSearch(event.target)) event.preventDefault();
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
