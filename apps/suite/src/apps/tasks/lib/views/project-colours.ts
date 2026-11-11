// AUTHORED-BY Codex GPT-6.1-Sol
/** Stable wire values; CSS tokens adapt their appearance to the active theme. */
export const PROJECT_COLOURS = [
  { name: "Red", hex: "#B91C1C", token: "red" },
  { name: "Orange", hex: "#C2410C", token: "orange" },
  { name: "Amber", hex: "#B45309", token: "amber" },
  { name: "Yellow", hex: "#A16207", token: "yellow" },
  { name: "Lime", hex: "#4D7C0F", token: "lime" },
  { name: "Green", hex: "#15803D", token: "green" },
  { name: "Teal", hex: "#0F766E", token: "teal" },
  { name: "Cyan", hex: "#0E7490", token: "cyan" },
  { name: "Blue", hex: "#1D4ED8", token: "blue" },
  { name: "Violet", hex: "#6D28D9", token: "violet" },
  { name: "Purple", hex: "#7E22CE", token: "purple" },
  { name: "Pink", hex: "#BE185D", token: "pink" },
] as const;

/** Pod strings never become CSS: only a known palette token can reach a style. */
export function projectColour(value: string | undefined) {
  if (!value || !/^#[\da-f]{6}$/i.test(value)) return undefined;
  return PROJECT_COLOURS.find((colour) => colour.hex === value.toUpperCase());
}

export function projectColourStyle(value: string | undefined) {
  const colour = projectColour(value);
  return {
    backgroundColor: colour ? `var(--tsk-project-${colour.token})` : "var(--foreground-muted)",
  };
}
