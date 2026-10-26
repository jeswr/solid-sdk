// AUTHORED-BY Codex
"use client";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { runSlash } from "../editor/actions";
import { filterSlash } from "../lib/editor/logic";
export interface SlashPosition {
  from: number;
  to: number;
  left: number;
  top: number;
  query: string;
}
export function SlashMenu({
  editor,
  position,
  close,
  image,
}: {
  editor: Editor;
  position: SlashPosition;
  close: () => void;
  image: () => void;
}) {
  const [query, setQuery] = useState(position.query);
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          close();
          editor.commands.focus();
        }
      }}
    >
      <PopoverAnchor asChild>
        <span
          style={{ position: "fixed", left: position.left, top: position.top, width: 1, height: 1 }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        className="docs-slash-popover"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Command label="Insert a block" shouldFilter={false}>
          <CommandInput
            aria-label="Filter blocks"
            placeholder="Insert a block…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList aria-label="Block types">
            <CommandEmpty>No matching blocks</CommandEmpty>
            {filterSlash(query).map((item) => (
              <CommandItem
                key={item}
                value={item}
                onSelect={() => {
                  close();
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: position.from, to: position.to })
                    .run();
                  runSlash(editor, item, image);
                }}
              >
                {item}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
