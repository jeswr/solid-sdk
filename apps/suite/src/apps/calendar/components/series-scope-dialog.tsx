// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
} from "@jeswr/suite-ui";
import type { SeriesMode } from "../state/editing";

/** The recurring-event scope question, shared by the editor and drag-and-drop. */
export function SeriesScopeDialog({
  action,
  onChoose,
  onCancel,
}: {
  action: "save" | "delete" | undefined;
  onChoose: (mode: SeriesMode) => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent className="cal-series-dialog">
        <AlertDialogTitle>
          {action === "delete" ? "Delete recurring event" : "Edit recurring event"}
        </AlertDialogTitle>
        <AlertDialogDescription>Which events should change?</AlertDialogDescription>
        {(
          [
            ["this", "This event"],
            ["following", "This and following events"],
            ["all", "All events"],
          ] as const
        ).map(([mode, label]) => (
          <Button key={mode} onClick={() => onChoose(mode)}>
            {label}
          </Button>
        ))}
        <AlertDialogCancel>Cancel</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>
  );
}
