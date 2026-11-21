// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@jeswr/suite-ui";
import { useId, useState } from "react";
import type { StoredProject } from "../../lib/model/store";
import type { Category } from "../../lib/model/tracker";
import { useTasks } from "../../state/tasks-context";

export function WipLimitDialog({
  project,
  section,
  close,
  restoreFocus,
}: {
  project: StoredProject;
  section: Category;
  close: () => void;
  restoreFocus: () => void;
}) {
  const { cache } = useTasks();
  const id = useId();
  const [value, setValue] = useState(String(section.wipLimit ?? ""));
  const limit = Number(value);
  const valid = Number.isSafeInteger(limit) && limit > 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>WIP limit</DialogTitle>
          <DialogDescription>{section.name}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void cache.updateProject(project, (tracker) =>
              tracker.setSectionWipLimit(section.id, limit),
            );
            close();
          }}
        >
          <Label htmlFor={id}>WIP limit</Label>
          <Input
            id={id}
            type="number"
            min={1}
            step={1}
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
