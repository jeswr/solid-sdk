// AUTHORED-BY Codex
"use client";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@jeswr/suite-ui";
import type { DownloadFormat } from "../editor/export-document";
import { MARKDOWN_NOTES } from "../lib/convert/markdown";

export function DownloadMenu({
  download,
  print,
}: {
  download: (format: DownloadFormat) => void;
  print: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Download</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="docs-download-menu">
        <DropdownMenuItem onSelect={() => download("docx")}>
          Microsoft Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download("md")} aria-describedby="docs-markdown-notes">
          Markdown (.md)
        </DropdownMenuItem>
        <p id="docs-markdown-notes" className="docs-menu-help">
          {MARKDOWN_NOTES}
        </p>
        <DropdownMenuItem onSelect={print} aria-describedby="docs-print-help">
          Print / Save as PDF
        </DropdownMenuItem>
        <p id="docs-print-help" className="docs-menu-help">
          Choose 'Save as PDF' in the print dialog
        </p>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
