// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { Slide } from "@jeswr/solid-slides";
export function presentationStep(
  key: string,
  current: number,
  length: number,
): number | "exit" | undefined {
  if (key === "Escape") return "exit";
  if (key === "Home") return 0;
  if (key === "End") return Math.max(0, length - 1);
  if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(key))
    return Math.min(Math.max(0, length - 1), current + 1);
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(key)) return Math.max(0, current - 1);
}
export function visibleSlides(slides: readonly Slide[]) {
  return slides.filter((slide) => !slide.hidden);
}
export function elapsedTime(started: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function isPresenterCommand(value: unknown): value is { key: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    typeof value.key === "string" &&
    presentationStep(value.key, 0, 1) !== undefined
  );
}
const ACTIVATES =
  "button, a[href], input, select, textarea, summary, [contenteditable=''], [contenteditable='true'], [role='button'], [role='checkbox'], [role='switch'], [role='option'], [role='menuitem'], [role='tab']";
const EDITS = "input, select, textarea, [contenteditable=''], [contenteditable='true']";
/**
 * Whether a presenter shortcut should leave the key to the focused control: Space activates
 * buttons and links, and text fields keep every key.
 */
export function keepsKey(key: string, target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest(key === " " ? ACTIVATES : EDITS));
}
/** The presenter window's channel, from its `?presenter=` query; null in a normal window. */
export function presenterChannel(search: string): string | null {
  return new URLSearchParams(search).get("presenter") || null;
}
