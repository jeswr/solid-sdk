// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
"use client";
import { PopoverContent } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { type ComponentProps, useRef } from "react";
import { focusDocument } from "../editor/focus";

type EditorPopoverProps = Omit<ComponentProps<typeof PopoverContent>, "onCloseAutoFocus"> & {
  editor: Editor;
  restoreFocus?: () => void;
} & ({ "aria-label": string } | { "aria-labelledby": string });

/** Restore editing focus on close unless an outside interaction moved it. */
export function EditorPopoverContent({
  editor,
  restoreFocus = () => focusDocument(editor),
  onInteractOutside,
  onEscapeKeyDown,
  ...props
}: EditorPopoverProps) {
  const outside = useRef(false);
  return (
    <PopoverContent
      {...props}
      onInteractOutside={(event) => {
        onInteractOutside?.(event);
        if (!event.defaultPrevented) outside.current = true;
      }}
      onEscapeKeyDown={(event) => {
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented) outside.current = false;
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!outside.current) restoreFocus();
      }}
    />
  );
}
