"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { ReactNode } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}
export interface PaletteGroup {
  heading: string;
  items: PaletteCommand[];
}

/** ⌘K command palette over the app's actions and saved views. */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Search actions and views">
      <CommandInput placeholder="Type a command or view…" />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        {groups
          .filter((g) => g.items.length > 0)
          .map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  onSelect={() => {
                    onOpenChange(false);
                    cmd.run();
                  }}
                >
                  {cmd.icon}
                  <span>{cmd.label}</span>
                  {cmd.hint && <span className="ml-auto text-xs text-muted-foreground">{cmd.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
      </CommandList>
    </CommandDialog>
  );
}
