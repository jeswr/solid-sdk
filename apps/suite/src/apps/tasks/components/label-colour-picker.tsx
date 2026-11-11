// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@jeswr/suite-ui";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { unionLabels } from "../lib/model/tracker";
import { setLabelColour } from "../state/label-colour";
import { useTasks } from "../state/tasks-context";
import { labelTargets } from "../state/view-actions";
import { ColourPicker } from "./colour-picker";

/** Share the project palette, keyboard operation and focus behaviour. */
export function LabelColourPicker({ name, menu = false }: { name: string; menu?: boolean }) {
  const tasks = useTasks();
  const [open, setOpen] = useState(false);
  const colour = unionLabels(tasks.projects.map((project) => project.tracker)).get(
    name.toLowerCase(),
  )?.[0]?.color;
  const disabled = !labelTargets(name, tasks.projects).some(({ project }) => project.etag);
  return (
    <ColourPicker
      colour={colour}
      open={open}
      onOpenChange={setOpen}
      onSelect={(colour) => {
        void setLabelColour(name, colour, tasks);
      }}
    >
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              className="tsk-project-actions"
              label={`Label actions for @${name}`}
              variant="ghost"
            >
              <Ellipsis size={16} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => requestAnimationFrame(() => setOpen(true))}
            >
              Colour
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          Colour
        </Button>
      )}
    </ColourPicker>
  );
}
