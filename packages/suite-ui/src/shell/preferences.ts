// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

/** null follows the responsive default; explicit choices survive viewport changes. */
export interface ShellPreferences {
  sidebarOpen: boolean | null;
  detailsOpen: boolean | null;
}
export const defaultShellPreferences: ShellPreferences = { sidebarOpen: null, detailsOpen: null };

export function parseShellPreferences(value: unknown): ShellPreferences {
  if (!value || typeof value !== "object") return { ...defaultShellPreferences };
  const input = value as Record<string, unknown>;
  return {
    sidebarOpen: typeof input.sidebarOpen === "boolean" ? input.sidebarOpen : null,
    detailsOpen: typeof input.detailsOpen === "boolean" ? input.detailsOpen : null,
  };
}

export function shellDocumentTitle(page: string, app: string): string {
  return `${page} · ${app} · Solid Suite`;
}

export function isShellShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "defaultPrevented"
  >,
  target: EventTarget | null,
): event is KeyboardEvent {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  if (isEditableTarget(target)) return false;
  return event.key === "[" || event.key === "]";
}

const editable =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]';
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(editable) !== null;
}

/** An unconsumed, unmodified Escape outside editable fields and nested dialogs closes a pane. */
export function shouldClosePaneOnEscape(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "defaultPrevented"
  >,
  target: EventTarget | null,
): boolean {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  if (isEditableTarget(target)) return false;
  return !(
    target instanceof Element && target.closest('dialog, [role="dialog"], [role="alertdialog"]')
  );
}
