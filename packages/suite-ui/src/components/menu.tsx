// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

export function MenuContent({ children, label }: { children: ReactNode; label: string }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className="suite-menu"
        aria-label={label}
        sideOffset={4}
        collisionPadding={16}
        loop
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
