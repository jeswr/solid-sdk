// AUTHORED-BY Claude Opus 5.5
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@jeswr/suite-ui";
import {
  Copy,
  Download,
  FolderInput,
  FolderOpen,
  Info,
  Link2,
  type LucideIcon,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { DriveItem } from "../lib/client/client";
import type { DriveActions } from "../state/ui";
import { useDriveUi } from "../state/ui";

export type MenuEntry =
  | {
      id: string;
      label: string;
      icon: LucideIcon;
      shortcut?: string;
      destructive?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | "separator";

export function useItemMenu(
  actions: DriveActions,
  targets: readonly DriveItem[],
  siblings: readonly DriveItem[],
): MenuEntry[] {
  const ui = useDriveUi();
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
    entries.push("separator");
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
      label: "Rename",
      icon: Pencil,
      shortcut: "F2",
      onSelect: () => ui.openDialog({ kind: "rename", item: first }),
    });
  }
  entries.push({
    id: "move",
    label: "Move to…",
    icon: FolderInput,
    shortcut: "M",
    onSelect: () => ui.openDialog({ kind: "move", items: [...targets] }),
  });
  if (single && first.kind === "file") {
    entries.push({
      id: "copy",
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
    label: "Move to trash",
    icon: Trash2,
    shortcut: "Del",
    destructive: true,
    onSelect: () => void actions.trash(targets),
  });
  return entries;
}

export function trashMenu(onRestore: () => void, onDelete: () => void): MenuEntry[] {
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

export function DropdownEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return (
    <DropdownMenuContent align="end" className="drv-menu">
      {entries.map((entry, index) =>
        entry === "separator" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
          <DropdownMenuSeparator key={`sep-${index}`} />
        ) : (
          <DropdownMenuItem
            key={entry.id}
            onSelect={entry.onSelect}
            disabled={entry.disabled ?? false}
            variant={entry.destructive ? "destructive" : "default"}
          >
            <entry.icon aria-hidden="true" size={16} />
            {entry.label}
            {entry.shortcut ? <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ),
      )}
    </DropdownMenuContent>
  );
}

export function ContextEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return (
    <ContextMenuContent className="drv-menu">
      {entries.map((entry, index) =>
        entry === "separator" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
          <ContextMenuSeparator key={`sep-${index}`} />
        ) : (
          <ContextMenuItem
            key={entry.id}
            onSelect={entry.onSelect}
            disabled={entry.disabled ?? false}
            variant={entry.destructive ? "destructive" : "default"}
          >
            <entry.icon aria-hidden="true" size={16} />
            {entry.label}
            {entry.shortcut ? <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut> : null}
          </ContextMenuItem>
        ),
      )}
    </ContextMenuContent>
  );
}
