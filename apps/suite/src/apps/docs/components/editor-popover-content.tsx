// AUTHORED-BY Codex
"use client";
import { PopoverContent } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import type { ComponentProps } from "react";

/** Editor popovers have anchors, so dismissal must restore their editing focus. */
export function EditorPopoverContent({
  editor,
  ...props
}: Omit<ComponentProps<typeof PopoverContent>, "onCloseAutoFocus"> & { editor: Editor }) {
  return (
    <PopoverContent
      {...props}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!editor.isDestroyed) editor.commands.focus();
      }}
    />
  );
}
