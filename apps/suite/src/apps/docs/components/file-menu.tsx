// AUTHORED-BY Codex
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@jeswr/suite-ui";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import type { DownloadFormat } from "../editor/export-document";
import { DownloadMenu } from "./download-menu";
export function FileMenu({
  copy,
  rename,
  remove,
  shortcuts,
  draft,
  readOnly,
  download,
  print,
  importFile,
}: {
  copy: () => void;
  rename: () => void;
  remove: () => void;
  shortcuts: () => void;
  draft: boolean;
  readOnly: boolean;
  download: (format: DownloadFormat) => void;
  print: () => void;
  importFile: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="File menu" variant="ghost">
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/docs/new">New</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy} disabled={draft}>
          Make a copy
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={rename} disabled={readOnly}>
          Rename
        </DropdownMenuItem>
        <DownloadMenu download={download} print={print} />
        <DropdownMenuItem disabled={readOnly} onSelect={importFile}>
          Import to replace…
        </DropdownMenuItem>
        <DropdownMenuItem disabled>Details — Coming soon</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={remove} disabled={draft || readOnly} variant="destructive">
          Move to trash
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={shortcuts}>Keyboard shortcuts</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
