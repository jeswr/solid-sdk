// AUTHORED-BY Codex
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { Table2 } from "lucide-react";
export function tableCommands(editor: Editor) {
  const actions: readonly [string, () => void][] = [
    [
      "Add row above",
      () => {
        editor.chain().focus().addRowBefore().run();
      },
    ],
    [
      "Add row below",
      () => {
        editor.chain().focus().addRowAfter().run();
      },
    ],
    [
      "Add column left",
      () => {
        editor.chain().focus().addColumnBefore().run();
      },
    ],
    [
      "Add column right",
      () => {
        editor.chain().focus().addColumnAfter().run();
      },
    ],
    [
      "Delete row",
      () => {
        editor.chain().focus().deleteRow().run();
      },
    ],
    [
      "Delete column",
      () => {
        editor.chain().focus().deleteColumn().run();
      },
    ],
    [
      "Toggle header row",
      () => {
        editor.chain().focus().toggleHeaderRow().run();
      },
    ],
    [
      "Delete table",
      () => {
        editor.chain().focus().deleteTable().run();
      },
    ],
  ];
  return actions;
}
export function TableActions({ editor }: { editor: Editor }) {
  const actions = tableCommands(editor);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Table actions" variant="ghost">
          <Table2 aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {actions.map(([label, run]) => (
          <DropdownMenuItem key={label} onSelect={run}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
