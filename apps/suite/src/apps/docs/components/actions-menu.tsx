// AUTHORED-BY Codex
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
} from "@jeswr/suite-ui";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useRef } from "react";

/** Open overlays only after the menu returns focus to its durable trigger. */
export function ActionsMenu({
  label,
  children,
}: {
  label: string;
  children: (choose: (run: () => void) => () => void) => ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const choose = (run: () => void) => () => {
    afterClose.current = run;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton ref={trigger} label={label} variant="ghost">
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
            trigger.current?.focus();
            run();
          }
        }}
      >
        {children(choose)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
