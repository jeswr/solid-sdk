// AUTHORED-BY Codex
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
} from "@jeswr/suite-ui";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
export function FileMenu({
  copy,
  rename,
  remove,
  shortcuts,
  draft,
  readOnly,
}: {
  copy: () => void;
  rename: () => void;
  remove: () => void;
  shortcuts: () => void;
  draft: boolean;
  readOnly: boolean;
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Download</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem disabled>Markdown — Coming soon</DropdownMenuItem>
            <DropdownMenuItem disabled>Microsoft Word — Coming soon</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => window.print()}>Print / Save as PDF</DropdownMenuItem>
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
