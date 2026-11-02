// AUTHORED-BY Claude Opus 5.5
"use client";
import { ToggleGroup, ToggleGroupItem } from "@jeswr/suite-ui";
import { Columns3, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { encodeRef } from "@/lib/refs";
import { isEditing } from "../state/add-focus";
import { useTasksPreferences } from "../state/preferences";
import { viewModeShortcut } from "../state/shortcuts";
import "./selection.css";

export type ViewMode = "list" | "board";

export function projectHref(projectUrl: string, mode: ViewMode): string {
  return `/tasks/p/${encodeRef(projectUrl)}${mode === "board" ? "/board" : ""}`;
}

/** The persisted List | Board choice for one project (06-tasks §5.8 `viewMode[trackerRef]`). */
export function useViewMode(projectUrl: string | undefined) {
  const { preferences, dispatch } = useTasksPreferences();
  const ref = projectUrl ? encodeRef(projectUrl) : undefined;
  return {
    mode: (ref && preferences.viewMode[ref]) || "list",
    set: (value: ViewMode) => {
      if (ref) dispatch({ type: "viewMode", viewId: ref, value });
    },
  };
}

/** TopBar List | Board toggle (06-tasks §2.5); `b` and Shift+L switch from the keyboard. */
export function ViewToggle({ projectUrl, mode }: { projectUrl: string; mode: ViewMode }) {
  const router = useRouter();
  const viewMode = useViewMode(projectUrl);
  const choose = (value: ViewMode) => {
    viewMode.set(value);
    if (value !== mode) router.push(projectHref(projectUrl, value));
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const value = viewModeShortcut({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        editable: isEditing(event.target),
      });
      if (!value || value === mode) return;
      event.preventDefault();
      viewMode.set(value);
      router.push(projectHref(projectUrl, value));
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  });
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      className="tsk-view-toggle"
      aria-label="Project layout"
      value={mode}
      onValueChange={(value) => {
        if (value === "list" || value === "board") choose(value);
      }}
    >
      <ToggleGroupItem value="list" aria-label="List">
        <List size={16} aria-hidden="true" />
        <span className="tsk-view-toggle-label">List</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="board" aria-label="Board">
        <Columns3 size={16} aria-hidden="true" />
        <span className="tsk-view-toggle-label">Board</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
