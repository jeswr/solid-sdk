// AUTHORED-BY Codex GPT-6
import { shortcutsEnabled } from "../../state/shortcuts";
export function itemShortcut(
  event: Pick<
    KeyboardEvent,
    "target" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "defaultPrevented"
  >,
): boolean {
  return (
    shortcutsEnabled() &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !(
      event.target instanceof HTMLElement &&
      event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="dialog"]',
      )
    )
  );
}
