// AUTHORED-BY Codex
"use client";
import { PopoverContent } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { type ComponentProps, useRef } from "react";

type EditorPopoverProps = Omit<ComponentProps<typeof PopoverContent>, "onCloseAutoFocus"> & {
  editor: Editor;
} & ({ "aria-label": string } | { "aria-labelledby": string });

/** Restore editing focus on close unless an outside interaction moved it. */
export function EditorPopoverContent({
  editor,
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
        if (!outside.current && !editor.isDestroyed) editor.commands.focus();
      }}
    />
  );
}
