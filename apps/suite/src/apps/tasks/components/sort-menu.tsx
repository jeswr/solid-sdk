// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@jeswr/suite-ui";
import { ArrowDownWideNarrow } from "lucide-react";
import { type GroupMode, groupOptions } from "../lib/views/grouping";
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
  crossProject = false,
}: {
  viewId: string;
  defaultSort?: SortMode;
  crossProject?: boolean;
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
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
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
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Group by</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={preferences.groupBy[viewId] ?? "none"}
              onValueChange={(value) =>
                dispatch({ type: "groupBy", viewId, value: value as GroupMode })
              }
            >
              {Object.entries(groupOptions)
                .filter(([value]) => value !== "project" || crossProject)
                .map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
