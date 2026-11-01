// AUTHORED-BY Codex
"use client";
import { DropdownMenuItem, DropdownMenuSeparator } from "@jeswr/suite-ui";
import Link from "next/link";
import type { DownloadFormat } from "../editor/export-document";
import { ActionsMenu } from "./actions-menu";
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
    <ActionsMenu label="File menu">
      {(choose) => (
        <>
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
        </>
      )}
    </ActionsMenu>
  );
}
