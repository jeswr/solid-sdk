// AUTHORED-BY Codex GPT-6.1-Sol

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
  if (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
    )
  )
    return false;
  return event.key === "[" || event.key === "]";
}
