// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/** Drive sidebar (04-drive §2.1): New menu, navigation, usage and demo reset. */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@jeswr/suite-ui";
import {
  Clock,
  FilePlus2,
  FolderPlus,
  FolderUp,
  HardDrive,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatFileSize } from "../lib/files";
import { useDrive } from "../state/drive-context";
import { useDriveUi } from "../state/ui";

const NAV = [
  { href: "/drive/my", label: "My Drive", icon: HardDrive, match: ["/drive/my", "/drive/f/"] },
  { href: "/drive/shared", label: "Shared with me", icon: Users, match: ["/drive/shared"] },
  { href: "/drive/recent", label: "Recent", icon: Clock, match: ["/drive/recent"] },
  { href: "/drive/starred", label: "Starred", icon: Star, match: ["/drive/starred"] },
  { href: "/drive/trash", label: "Trash", icon: Trash2, match: ["/drive/trash"] },
];

export function NewMenu({
  fab = false,
  open,
  onOpenChange,
}: {
  fab?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const ui = useDriveUi();
  const { driveRoot } = useDrive();
  const folder = ui.currentFolder ?? driveRoot;
  return (
    <DropdownMenu
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <DropdownMenuTrigger asChild>
        {fab ? (
          <button type="button" className="drv-fab" aria-label="New">
            <Plus aria-hidden="true" size={24} />
          </button>
        ) : (
          <Button className="drv-new" size="lg">
            <Plus aria-hidden="true" size={20} /> New
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="drv-menu">
        <DropdownMenuItem
          disabled={!folder}
          onSelect={() => folder && ui.openDialog({ kind: "new-folder", parent: folder })}
        >
          <FolderPlus aria-hidden="true" size={16} /> New folder
          <DropdownMenuShortcut>⇧F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!ui.currentFolder} onSelect={() => ui.requestUpload(false)}>
          <Upload aria-hidden="true" size={16} /> File upload
          <DropdownMenuShortcut>⇧U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!ui.currentFolder} onSelect={() => ui.requestUpload(true)}>
          <FolderUp aria-hidden="true" size={16} /> Folder upload
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <FilePlus2 aria-hidden="true" size={16} /> New document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DriveSidebar({
  usage,
  usageFailed,
  onRetryUsage,
  newMenuOpen,
  onNewMenuOpenChange,
}: {
  usage: number | undefined;
  usageFailed?: boolean;
  onRetryUsage?: () => void;
  newMenuOpen?: boolean;
  onNewMenuOpenChange?: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const { session } = useDrive();
  return (
    <div className="drv-sidebar">
      <NewMenu
        {...(newMenuOpen !== undefined ? { open: newMenuOpen } : {})}
        {...(onNewMenuOpenChange ? { onOpenChange: onNewMenuOpenChange } : {})}
      />
      <nav aria-label="Drive">
        <ul>
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <li key={href}>
              <Link
                href={href}
                className="drv-nav-item"
                aria-current={
                  match.some((prefix) => pathname.startsWith(prefix)) ? "page" : undefined
                }
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="drv-sidebar-foot">
        <div className="drv-usage" role={usageFailed ? "alert" : undefined}>
          {usageFailed ? (
            <>
              <p>Couldn't measure usage.</p>
              <Button variant="outline" size="sm" onClick={onRetryUsage}>
                Retry
              </Button>
            </>
          ) : usage === undefined ? (
            "Measuring usage…"
          ) : (
            `${formatUsage(usage)} used`
          )}
        </div>
        {session.mode === "demo" ? (
          <div className="drv-demo">
            <p>
              You're using a demo pod stored in this browser as{" "}
              <strong>{session.displayName}</strong>.
            </p>
            <Button variant="ghost" size="sm" onClick={() => void session.reset()}>
              <RotateCcw aria-hidden="true" size={14} /> Reset demo
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatUsage(bytes: number): string {
  return formatFileSize(Math.max(0, Math.round(bytes)));
}
