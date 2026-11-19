// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AppGlyph,
  type AppSlug,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
  type NavigationApp,
  suiteApps,
  visibleNavigationApps,
} from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { type MouseEvent, useRef, useState } from "react";
import { useShortcutSettings } from "../shortcuts/provider";

export interface PaletteCreateAction {
  id: string;
  label: string;
  run: () => void;
  keys?: string;
}
export interface PaletteRecent {
  id: string;
  title: string;
  href: string;
  app: AppSlug;
  keys?: string;
}
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createActions?: readonly PaletteCreateAction[];
  recent?: readonly PaletteRecent[];
  onSearch: (query: string) => void;
  /**
   * Opens the keyboard-shortcut help, which holds the single-key on/off switch. Gets the
   * element focused before the palette opened, so help can return focus there.
   */
  onOpenHelp?: (returnTo: HTMLElement | null) => void;
  /** Opens the app launcher (02-suite-shell §3: Cmd/Ctrl+K → "Open app…"). */
  onOpenApps?: () => void;
  apps?: readonly NavigationApp[];
  showBacklog?: boolean;
}
export const appShortcutKeys: Partial<Record<AppSlug, string>> = {
  home: "g h",
  drive: "g d",
  docs: "g o",
  tasks: "g t",
  calendar: "g c",
  permissions: "g p",
};

function preserveModifiedNavigation(event: MouseEvent<HTMLAnchorElement>) {
  // Keep native new-tab/window navigation from also running cmdk's selection handler.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) event.stopPropagation();
}

export function CommandPalette({
  open,
  onOpenChange,
  createActions = [],
  recent = [],
  onSearch,
  onOpenHelp,
  onOpenApps,
  apps = suiteApps,
  showBacklog = process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1",
}: CommandPaletteProps) {
  const router = useRouter();
  // Single-key hints are noise (and wrong) once the user has turned those keys off.
  const { characterKeys } = useShortcutSettings();
  const [query, setQuery] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const select = (run: () => void) => {
    onOpenChange(false);
    setQuery("");
    run();
  };
  const navigation = [
    ...visibleNavigationApps(apps, showBacklog).map((app) => ({
      id: app.slug,
      label: app.name,
      href: app.basePath,
      keys: appShortcutKeys[app.slug],
      app: app.slug,
    })),
    { id: "settings", label: "Settings", href: "/settings", keys: "g s", app: undefined },
    {
      id: "notifications",
      label: "Notifications",
      href: "/notifications",
      keys: "g n",
      app: undefined,
    },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setQuery("");
      }}
    >
      <DialogContent
        className="p-0 pt-6"
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogTitle className="px-4">Command palette</DialogTitle>
        <DialogDescription className="px-4">
          Open an app, create an item, or search your storage.
        </DialogDescription>
        <Command label="Find an action" loop>
          <label className="px-4 text-sm" htmlFor="suite-command-query">
            Find an action
          </label>
          <CommandInput
            id="suite-command-query"
            value={query}
            onValueChange={setQuery}
            placeholder="Type an app or action"
          />
          <CommandList>
            <CommandEmpty>No matching actions</CommandEmpty>
            <CommandGroup heading="Go to">
              {navigation.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`Go to ${item.label}`}
                  onSelect={() => select(() => router.push(item.href))}
                  asChild
                >
                  <a
                    href={item.href}
                    onClickCapture={preserveModifiedNavigation}
                    onClick={(event) => event.preventDefault()}
                  >
                    {item.app && <AppGlyph app={item.app} />}
                    <span>{item.label}</span>
                    {item.keys && characterKeys && <Kbd className="ml-auto">{item.keys}</Kbd>}
                  </a>
                </CommandItem>
              ))}
            </CommandGroup>
            {onOpenApps && (
              <CommandGroup heading="Apps">
                <CommandItem value="Open app…" onSelect={() => select(onOpenApps)}>
                  Open app…
                </CommandItem>
              </CommandGroup>
            )}
            {onOpenHelp && (
              <CommandGroup heading="Help">
                <CommandItem
                  value="Keyboard shortcuts"
                  onSelect={() => select(() => onOpenHelp(returnFocus.current))}
                >
                  Keyboard shortcuts
                  {characterKeys && <Kbd className="ml-auto">?</Kbd>}
                </CommandItem>
              </CommandGroup>
            )}
            {createActions.length > 0 && (
              <CommandGroup heading="Create">
                {createActions.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={`Create ${action.label}`}
                    onSelect={() => select(action.run)}
                  >
                    {action.label}
                    {action.keys && <Kbd className="ml-auto">{action.keys}</Kbd>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {recent.length > 0 && (
              <CommandGroup heading="Recent">
                {recent.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`Recent ${item.title}`}
                    onSelect={() => select(() => router.push(item.href))}
                    asChild
                  >
                    <a
                      href={item.href}
                      onClickCapture={preserveModifiedNavigation}
                      onClick={(event) => event.preventDefault()}
                    >
                      <AppGlyph app={item.app} />
                      {item.title}
                      {item.keys && <Kbd className="ml-auto">{item.keys}</Kbd>}
                    </a>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query.trim() && (
              <CommandItem
                forceMount
                value={`Search ${query}`}
                onSelect={() => select(() => onSearch(query.trim()))}
              >
                Search for “{query.trim()}”
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
