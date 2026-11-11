// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Kbd,
} from "@jeswr/suite-ui";
import { useId } from "react";
import { Hint } from "./common";

export interface VersionMenuProps {
  showHistory: () => void;
  nameVersion: () => void;
  versionReason: string | undefined;
}
export function VersionMenu({ showHistory, nameVersion, versionReason }: VersionMenuProps) {
  const reasonId = useId();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Version history</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="docs-editor-menu">
        <Hint text={versionReason}>
          <DropdownMenuItem
            aria-disabled={!!versionReason}
            aria-describedby={versionReason ? reasonId : undefined}
            onSelect={(event) => {
              if (versionReason) event.preventDefault();
              else nameVersion();
            }}
          >
            Name current version…
          </DropdownMenuItem>
        </Hint>
        {versionReason && (
          <span className="su-sr-only" id={reasonId}>
            {versionReason}
          </span>
        )}
        <DropdownMenuItem onSelect={showHistory}>
          See version history <Kbd>Ctrl/Cmd+Alt+Shift+H</Kbd>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
