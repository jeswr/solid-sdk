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
import { useRef } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const choose = (run: () => void) => () => {
    afterClose.current = run;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton ref={trigger} label="File menu" variant="ghost">
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const run = afterClose.current;
          if (run) {
            event.preventDefault();
            afterClose.current = null;
            // Dialogs capture a durable invoking control, after the transient
            // menu item has unmounted. Rename can then move focus to the title.
            trigger.current?.focus();
            run();
          }
        }}
      >
        <DropdownMenuItem asChild>
          <Link href="/docs/new">New</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy} disabled={draft}>
          Make a copy
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={choose(rename)} disabled={readOnly}>
          Rename
        </DropdownMenuItem>
        <DownloadMenu download={download} print={print} />
        <DropdownMenuItem disabled={readOnly} onSelect={choose(importFile)}>
          Import to replace…
        </DropdownMenuItem>
        <DropdownMenuItem disabled>Details — Coming soon</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={choose(remove)}
          disabled={draft || readOnly}
          variant="destructive"
        >
          Move to trash
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={choose(shortcuts)}>Keyboard shortcuts</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
