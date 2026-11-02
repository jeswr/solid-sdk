// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@jeswr/suite-ui";
import { ArrowDownWideNarrow } from "lucide-react";
import type { SortMode } from "../lib/views/project-groups";
import { useTasksPreferences } from "../state/preferences";

const options: Record<SortMode, string> = {
  manual: "Manual",
  due: "Due date",
  priority: "Priority",
  name: "Name",
};
export function SortMenu({
  viewId,
  defaultSort = "manual",
}: {
  viewId: string;
  defaultSort?: SortMode;
}) {
  const { preferences, dispatch } = useTasksPreferences();
  const value = preferences.sort[viewId] ?? defaultSort;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="tsk-sort">
          <ArrowDownWideNarrow size={16} aria-hidden="true" />
          Sort: {options[value]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => dispatch({ type: "sort", viewId, value: value as SortMode })}
        >
          {Object.entries(options).map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
