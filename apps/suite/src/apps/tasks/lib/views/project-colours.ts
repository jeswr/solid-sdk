// AUTHORED-BY Codex GPT-6.1-Sol
import { PROJECT_COLOURS } from "@jeswr/suite-ui/tokens";

export { PROJECT_COLOURS };

/** Pod strings never become CSS: only a known palette token can reach a style. */
export function projectColour(value: string | undefined) {
  if (!value || !/^#[\da-f]{6}$/i.test(value)) return undefined;
  return PROJECT_COLOURS.find((colour) => colour.hex === value.toUpperCase());
}

export function projectColourStyle(value: string | undefined) {
  const colour = projectColour(value);
  return {
    backgroundColor: colour ? `var(--project-${colour.token})` : "var(--foreground-muted)",
  };
}
