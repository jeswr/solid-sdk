// AUTHORED-BY Codex
import { LevelFormat } from "docx";

// One mapping for both directions: clause labels are part of the document's meaning.
const formats = [
  ["a", LevelFormat.LOWER_LETTER],
  ["A", LevelFormat.UPPER_LETTER],
  ["i", LevelFormat.LOWER_ROMAN],
  ["I", LevelFormat.UPPER_ROMAN],
] as const;

export function wordListFormat(type: unknown) {
  return formats.find(([html]) => html === type)?.[1] ?? LevelFormat.DECIMAL;
}

export function htmlListType(format: string | undefined) {
  return formats.find(([, word]) => word === format)?.[0] ?? null;
}
