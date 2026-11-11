// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { ComponentProps } from "react";
import { ColourPicker } from "./colour-picker";

/** Preserve project behaviour: selecting an already absent colour is a no-op. */
export function ProjectColourPicker(props: ComponentProps<typeof ColourPicker>) {
  return (
    <ColourPicker
      {...props}
      onSelect={(colour) => {
        if (colour !== undefined || props.colour !== undefined) props.onSelect(colour);
      }}
    />
  );
}
