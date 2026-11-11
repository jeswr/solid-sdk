// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * The item menu (04-drive §4.5) as one model rendered two ways: the row's
 * `…` dropdown and the right-click context menu.
 */

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@jeswr/suite-ui";
import {
  AppWindow,
  Copy,
  Download,
  FileText,
  FolderInput,
  FolderOpen,
  Info,
  Link2,
  type LucideIcon,
  Pencil,
  RotateCcw,
  Share2,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { DriveItem } from "../lib/client/client";
import { isOwnStorage } from "../lib/client/ownership";
import { useDrive } from "../state/drive-context";
import { useOpenWithDocs } from "../state/open-with-docs";
import type { DriveActions } from "../state/ui";
import { useDriveUi } from "../state/ui";

export interface MenuItemEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Why a disabled item is unavailable, shown under its label. */
  hint?: string;
  onSelect: () => void;
}

/** A nested menu, e.g. "Open with" › "Docs". */
export interface SubmenuEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  submenu: readonly MenuItemEntry[];
}

export type MenuEntry = MenuItemEntry | SubmenuEntry | "separator";

export function useItemMenu(
  actions: DriveActions,
  targets: readonly DriveItem[],
  siblings: readonly DriveItem[],
): MenuEntry[] {
  const ui = useDriveUi();
  const { session } = useDrive();
  const openWithDocs = useOpenWithDocs(targets.length === 1 ? targets[0] : undefined);
  const writable = targets.every((item) => isOwnStorage(item.url, session.storageUrl));
  const [first] = targets;
  if (!first) return [];
  const single = targets.length === 1;
  const allStarred = targets.every((item) => actions.starred.has(item.url));
  const entries: MenuEntry[] = [];
  if (single) {
    entries.push({
      id: "open",
      label: "Open",
      icon: FolderOpen,
      shortcut: "Enter",
      onSelect: () => actions.open(first, siblings, ui.setPreview),
    });
    if (openWithDocs) {
      const disabledReason =
        openWithDocs.kind === "convert" ? openWithDocs.disabledReason : undefined;
      entries.push({
        id: "open-with",
        label: "Open with",
        icon: AppWindow,
        submenu: [
          {
            id: "open-with-docs",
            label: "Docs",
            icon: FileText,
            disabled: disabledReason !== undefined || openWithDocs.pending,
            ...(disabledReason ? { hint: disabledReason } : {}),
            onSelect: () => void openWithDocs.run(),
          },
        ],
      });
    }
    entries.push("separator");
    entries.push({
      id: "share",
      label: "Share",
      icon: Share2,
      onSelect: () => ui.openDialog({ kind: "share", item: first }),
    });
    entries.push({
      id: "copy-link",
      label: "Copy link",
      icon: Link2,
      onSelect: () => void actions.copyLink(first),
    });
    if (first.kind === "file") {
      entries.push({
        id: "download",
        label: "Download",
        icon: Download,
        onSelect: () => void actions.download(first),
      });
    }
    entries.push("separator");
    entries.push({
      id: "rename",
      disabled: !writable,
      label: "Rename",
      icon: Pencil,
      shortcut: "F2",
      onSelect: () => ui.openDialog({ kind: "rename", item: first }),
    });
  }
  entries.push({
    id: "move",
    disabled: !writable,
    label: "Move to…",
    icon: FolderInput,
    shortcut: "M",
    onSelect: () => ui.openDialog({ kind: "move", items: [...targets] }),
  });
  if (single && first.kind === "file") {
    entries.push({
      id: "copy",
      disabled: !writable,
      label: "Make a copy",
      icon: Copy,
      onSelect: () => void actions.makeCopy(first),
    });
  }
  entries.push({
    id: "star",
    label: allStarred ? "Remove star" : "Star",
    icon: allStarred ? StarOff : Star,
    shortcut: "S",
    onSelect: () => actions.toggleStar(targets),
  });
  entries.push("separator");
  entries.push({
    id: "details",
    label: "Details",
    icon: Info,
    shortcut: "D",
    onSelect: () => {
      ui.setDetailsItems(targets);
      ui.setDetailsOpen(true);
    },
  });
  entries.push({
    id: "trash",
    disabled: !writable,
    label: "Move to trash",
    icon: Trash2,
    shortcut: "Del",
    destructive: true,
    onSelect: () => void actions.trash(targets),
  });
  return entries;
}

export function trashMenu(onRestore: () => void, onDelete: () => void): MenuItemEntry[] {
  return [
    { id: "restore", label: "Restore", icon: RotateCcw, onSelect: onRestore },
    {
      id: "delete",
      label: "Delete for ever",
      icon: Trash2,
      destructive: true,
      onSelect: onDelete,
    },
  ];
}

function ItemLabel({ entry }: { entry: MenuItemEntry }) {
  return entry.hint ? (
    <span className="drv-menu-label">
      {entry.label}
      <span className="drv-menu-hint">{entry.hint}</span>
    </span>
  ) : (
    entry.label
  );
}

function DropdownItems({ entries }: { entries: readonly MenuEntry[] }) {
  return entries.map((entry, index) =>
    entry === "separator" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
      <DropdownMenuSeparator key={`sep-${index}`} />
    ) : "submenu" in entry ? (
      <DropdownMenuSub key={entry.id}>
        <DropdownMenuSubTrigger>
          <entry.icon aria-hidden="true" size={16} />
          {entry.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="drv-menu">
          <DropdownItems entries={entry.submenu} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : (
      <DropdownMenuItem
        key={entry.id}
        onSelect={entry.onSelect}
        disabled={entry.disabled ?? false}
        variant={entry.destructive ? "destructive" : "default"}
      >
        <entry.icon aria-hidden="true" size={16} />
        <ItemLabel entry={entry} />
        {entry.shortcut ? <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    ),
  );
}

export function DropdownEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return (
    <DropdownMenuContent align="end" className="drv-menu">
      <DropdownItems entries={entries} />
    </DropdownMenuContent>
  );
}

function ContextItems({ entries }: { entries: readonly MenuEntry[] }) {
  return entries.map((entry, index) =>
    entry === "separator" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
      <ContextMenuSeparator key={`sep-${index}`} />
    ) : "submenu" in entry ? (
      <ContextMenuSub key={entry.id}>
        <ContextMenuSubTrigger>
          <entry.icon aria-hidden="true" size={16} />
          {entry.label}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="drv-menu">
          <ContextItems entries={entry.submenu} />
        </ContextMenuSubContent>
      </ContextMenuSub>
    ) : (
      <ContextMenuItem
        key={entry.id}
        onSelect={entry.onSelect}
        disabled={entry.disabled ?? false}
        variant={entry.destructive ? "destructive" : "default"}
      >
        <entry.icon aria-hidden="true" size={16} />
        <ItemLabel entry={entry} />
        {entry.shortcut ? <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    ),
  );
}

export function ContextEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return (
    <ContextMenuContent className="drv-menu">
      <ContextItems entries={entries} />
    </ContextMenuContent>
  );
}
