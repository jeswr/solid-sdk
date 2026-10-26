// AUTHORED-BY Claude Opus 5.5
/** Whether a key event target keeps its own keys, so Drive-wide shortcuts must ignore it. */
export function isTyping(target: EventTarget | null): boolean {
  return Boolean(
    (target as HTMLElement | null)?.closest?.(
      // Menus and listboxes use letters for typeahead, so Drive shortcuts stay out of them.
      "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='menubar'], [role='listbox']",
    ),
  );
}
