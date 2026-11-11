// AUTHORED-BY Codex (GPT-6.1 Sol)
import { SCENE_PALETTE } from "@jeswr/excalidraw-scene";

const TOKENS = {
  Ink: "--foreground",
  Ocean: "--primary",
  Leaf: "--success",
  Berry: "--chart-4",
  Coral: "--destructive",
  Sunshine: "--warning",
} as const;
/** Tokens style controls only; stored scene colours are fixed portable data. */
export const PALETTE = SCENE_PALETTE.map((c) => ({ ...c, token: TOKENS[c.name] }));
export function paletteColour(token: string): string {
  return token === "none"
    ? "transparent"
    : (PALETTE.find((c) => c.token === token)?.hex ?? SCENE_PALETTE[0].hex);
}
