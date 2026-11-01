// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { DropdownMenu } from "radix-ui";
import type { ReactNode, Ref } from "react";

export function MenuContent({
  children,
  label,
  ref,
}: {
  children: ReactNode;
  label: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        ref={ref}
        className="suite-menu"
        aria-label={label}
        // Radix names the menu after its trigger; the explicit label must win.
        aria-labelledby={undefined}
        sideOffset={4}
        collisionPadding={16}
        loop
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
