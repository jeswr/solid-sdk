// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import {
  CommandPalette,
  type PaletteCreateAction,
  type PaletteRecent,
} from "../search/command-palette";
import { ShortcutHelpSheet } from "./help-sheet";
import { useShortcut } from "./provider";

const destinations = [
  ["h", "Home", "/home"],
  ["d", "Drive", "/drive"],
  ["o", "Docs", "/docs"],
  ["t", "Tasks", "/tasks"],
  ["c", "Calendar", "/calendar"],
  ["p", "Permissions", "/permissions"],
  ["n", "Notifications", "/notifications"],
  ["s", "Settings", "/settings"],
] as const;
function GoToShortcut({ letter, name, href }: { letter: string; name: string; href: string }) {
  const router = useRouter();
  useShortcut({
    id: `global.go.${letter}`,
    keys: `g ${letter}`,
    label: `Go to ${name}`,
    group: "Global",
    run: () => router.push(href),
  });
  return null;
}
export function GlobalShortcuts({
  onOpenPalette,
  onOpenApps,
  onOpenHelp,
  createActions,
  recent,
  onSearch,
}: {
  onOpenPalette?: () => void;
  onOpenApps?: () => void;
  onOpenHelp?: () => void;
  createActions?: readonly PaletteCreateAction[];
  recent?: readonly PaletteRecent[];
  onSearch?: (query: string) => void;
} = {}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [helpReturn, setHelpReturn] = useState<HTMLElement | null>(null);
  const openHelp = (returnTo: HTMLElement | null = null) => {
    setHelpReturn(returnTo);
    if (onOpenHelp) onOpenHelp();
    else setHelpOpen(true);
  };
  useShortcut({
    id: "global.search",
    keys: "/",
    label: "Focus global search",
    group: "Global",
    run: () => {
      const target = document.querySelector<HTMLElement>("[data-global-search]");
      if (target?.tagName === "BUTTON") target.click();
      else target?.focus();
    },
  });
  useShortcut({
    id: "global.help",
    keys: "?",
    label: "Keyboard shortcuts",
    group: "Global",
    run: () => openHelp(),
  });
  useShortcut({
    id: "global.theme",
    keys: "Shift+D",
    label: "Toggle dark mode",
    group: "Global",
    run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
  });
  useShortcut({
    id: "global.palette",
    keys: "Cmd/Ctrl+K",
    label: "Command palette",
    group: "Global",
    run: () => (onOpenPalette ? onOpenPalette() : setPaletteOpen((value) => !value)),
  });
  return (
    <>
      {destinations.map(([letter, name, href]) => (
        <GoToShortcut key={letter} letter={letter} name={name} href={href} />
      ))}
      {!onOpenHelp && (
        <ShortcutHelpSheet open={helpOpen} onOpenChange={setHelpOpen} returnFocusTo={helpReturn} />
      )}
      {!onOpenPalette && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          // The palette (Cmd/Ctrl+K) stays reachable when single keys are off, so the
          // help sheet and its switch can always be reopened (WCAG 2.1.4).
          onOpenHelp={openHelp}
          {...(onOpenApps ? { onOpenApps } : {})}
          {...(createActions ? { createActions } : {})}
          {...(recent ? { recent } : {})}
          onSearch={onSearch ?? ((query) => router.push(`/search?q=${encodeURIComponent(query)}`))}
        />
      )}
    </>
  );
}
