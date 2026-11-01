// AUTHORED-BY Codex
import { buildOutline, documentStatistics, projectPlainText } from "../outline";

export type SaveState = "saving" | "saved" | "retrying" | "failed";
export function relativeTime(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
export function saveStatus(
  state: SaveState,
  localState: SaveState,
  online: boolean,
  timestamp: number,
  now: number,
  readOnly = false,
): string {
  if (readOnly) return "View only";
  if (!online) return `Offline — ${deviceSaveStatus(localState)}`;
  if (localState !== "saved") return deviceSaveStatus(localState);
  if (state === "saving") return "Saving…";
  if (state === "retrying") return "Couldn't save — retrying";
  if (state === "failed") return "Couldn't save";
  return `Saved to your pod · ${relativeTime(timestamp, now)}`;
}
export function deviceSaveStatus(state: SaveState): string {
  if (state === "saving") return "Saving on this device…";
  if (state === "retrying") return "Not saved — retrying on this device";
  if (state === "failed") return "Couldn't save on this device";
  return "Saved on this device";
}
export const slashItems = [
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Bulleted list",
  "Numbered list",
  "Checklist",
  "Quote",
  "Code block",
  "Table",
  "Image",
  "Horizontal rule",
  "Date",
] as const;
export type SlashItem = (typeof slashItems)[number];
export function filterSlash(query: string): readonly SlashItem[] {
  const needle = query.trim().toLocaleLowerCase();
  return slashItems.filter((item) => item.toLocaleLowerCase().includes(needle));
}
export function slashQuery(beforeCursor: string): { query: string; length: number } | null {
  const match = /(?:^| )\/([^/\n]*)$/.exec(beforeCursor);
  if (!match) return null;
  const query = match[1] as string;
  return { query, length: query.length + 1 };
}
export function validLink(input: string): string | null {
  try {
    const value = input.trim();
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject URL parser control-character normalization
    if (/[\u0000-\u0020\u007f]/u.test(value)) return null;
    const url = new URL(value);
    if (!["http:", "https:", "mailto:"].includes(url.protocol) || url.username || url.password)
      return null;
    if (url.protocol === "mailto:" && !/^[^@]+@[^@]+$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function deriveTitle(input: unknown): string {
  const heading = buildOutline(input)[0]?.text;
  const text = heading || projectPlainText(input).text;
  return (
    text
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, heading ? 200 : 60) || "Untitled document"
  );
}
export function wordCount(input: unknown) {
  return documentStatistics(input);
}
export function keyboardLabel(keys: string, mac: boolean): string {
  return keys.replace(/Mod/g, mac ? "⌘" : "Ctrl").replace(/Alt/g, mac ? "⌥" : "Alt");
}
export function validateImage(file: { type: string; size: number }): string | null {
  if (file.size > 20 * 1024 * 1024) return "Images must be under 20 MB";
  if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(file.type))
    return "Choose a PNG, JPEG, GIF, WebP or SVG image";
  return null;
}
export const shortcuts = [
  ["Mod+B / I / U / Shift+X", "Bold / Italic / Underline / Strikethrough"],
  ["Mod+E", "Inline code"],
  ["Mod+Shift+H", "Highlight"],
  ["Mod+Alt+0 / 1 / 2 / 3", "Normal text / Heading 1 / 2 / 3"],
  ["Mod+Shift+7 / 8 / 9", "Numbered list / Bulleted list / Checklist"],
  ["Tab / Shift+Tab", "Indent / outdent; move between table cells"],
  ["Mod+Shift+B", "Blockquote"],
  ["Mod+Alt+C", "Code block"],
  ["Mod+Shift+L / E / R / J", "Align left / centre / right / justify"],
  ["Mod+K", "Insert or edit link"],
  ["Mod+F / Mod+H", "Find and replace"],
  ["Mod+Shift+C", "Word count"],
  ["Mod+Z / Mod+Shift+Z", "Undo / Redo"],
  ["Mod+\\", "Clear formatting"],
  ["Mod+/", "Keyboard shortcuts"],
  ["Mod+S", "Save now"],
  ["Esc / Esc", "Focus title / top bar"],
  ["/", "Insert a block"],
  ["[", "Toggle outline outside the editor"],
] as const;

/** Intercept app commands without stealing TipTap's formatting shortcuts. */
export function editorShortcut(
  key: string,
  mod: boolean,
  shift: boolean,
  alt: boolean,
): "save" | "find" | "link" | "count" | "help" | null {
  if (!mod || alt) return null;
  const normalized = key.toLowerCase();
  if (shift) return normalized === "c" ? "count" : null;
  switch (normalized) {
    case "s":
      return "save";
    case "f":
    case "h":
      return "find";
    case "k":
      return "link";
    case "/":
      return "help";
    default:
      return null;
  }
}
