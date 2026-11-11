// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  RadioGroup,
  RadioGroupItem,
} from "@jeswr/suite-ui";
import { type ReactNode, useId, useRef } from "react";
import { PROJECT_COLOURS, projectColour, projectColourStyle } from "../lib/views/project-colours";

export function ColourPicker({
  colour,
  open,
  onOpenChange,
  onSelect,
  selectChecked = false,
  children,
}: {
  colour: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (colour: string | undefined) => void;
  selectChecked?: boolean;
  children: ReactNode;
}) {
  const noneId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const interactedOutside = useRef(false);
  const selectedColour = projectColour(colour)?.hex ?? "none";
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div ref={anchor}>{children}</div>
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        className="tsk-colour-popover"
        aria-label="Colour"
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          interactedOutside.current = false;
          content.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
        }}
        onInteractOutside={() => {
          interactedOutside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!interactedOutside.current)
            anchor.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
      >
        <RadioGroup
          aria-label="Colour"
          value={selectedColour}
          onValueChange={(value) => onSelect(value === "none" ? undefined : value)}
          className="tsk-colour-swatches"
        >
          {PROJECT_COLOURS.map((colour) => (
            <RadioGroupItem
              key={colour.hex}
              value={colour.hex}
              aria-label={colour.name}
              title={colour.name}
              style={projectColourStyle(colour.hex)}
              onClick={() => {
                if (selectChecked && selectedColour === colour.hex) onSelect(colour.hex);
              }}
            />
          ))}
          <label className="tsk-no-colour" htmlFor={noneId}>
            <RadioGroupItem
              id={noneId}
              value="none"
              aria-label="No colour"
              onClick={() => {
                // Union labels may still have colours in later trackers when the first is neutral.
                if (selectedColour === "none") onSelect(undefined);
              }}
            />
            No colour
          </label>
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}
