// AUTHORED-BY Codex GPT-6.1-Sol
export type ShortcutScope = "global" | "app" | "editor";
export interface KeyStroke {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  cmd: boolean;
}
export interface ShortcutBinding {
  id: string;
  keys: string;
  scope?: ShortcutScope;
}
export interface ShortcutEvent {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  editable: boolean;
  now: number;
}

/** Cmd/Ctrl and Cmd are the platform's primary modifier; Meta and Ctrl are literal. */
export function parseKeys(keys: string): KeyStroke[] {
  if (!keys.trim()) throw new Error("Shortcut keys must not be empty");
  return keys
    .trim()
    .split(/\s+/)
    .map((part) => {
      const tokens = part.toLowerCase().split("+");
      const key = tokens.pop();
      if (
        !key ||
        tokens.some((token) => !["cmd/ctrl", "cmd", "meta", "ctrl", "alt", "shift"].includes(token))
      ) {
        throw new Error("Invalid shortcut keys");
      }
      const stroke = {
        key,
        cmd: tokens.includes("cmd") || tokens.includes("cmd/ctrl"),
        meta: tokens.includes("meta"),
        ctrl: tokens.includes("ctrl"),
        alt: tokens.includes("alt"),
        shift: tokens.includes("shift"),
      };
      if ((stroke.cmd || stroke.meta || stroke.ctrl) && ["t", "w", "n", "l", "r"].includes(key)) {
        throw new Error("Browser shortcuts cannot be registered");
      }
      return stroke;
    });
}

/** Duck typing also handles elements from another window and text-node event targets. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as Element;
  if (typeof element.closest !== "function") {
    return isEditableTarget((target as Node).parentElement);
  }
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-shortcuts="off"]',
  );
}

const scopeRank = { global: 0, app: 1, editor: 2 };

/** Narrower scopes win; the latest registration wins within a scope. No timers are needed. */
export function createSequenceMatcher(
  bindings: readonly ShortcutBinding[],
  { timeoutMs = 1000, platform = "" }: { timeoutMs?: number; platform?: string } = {},
) {
  const mac = /mac|iphone|ipad/i.test(platform);
  const registered = bindings
    .map((binding, order) => ({
      ...binding,
      order,
      strokes: parseKeys(binding.keys),
    }))
    .sort(
      (a, b) =>
        scopeRank[b.scope ?? "global"] - scopeRank[a.scope ?? "global"] || b.order - a.order,
    );
  let pending: typeof registered = [];
  let position = 0;
  let previousTime = 0;
  const reset = () => {
    pending = [];
    position = 0;
  };
  return {
    reset,
    feed(event: ShortcutEvent): { matched?: string; pending: boolean } {
      if (event.now - previousTime >= timeoutMs || event.now < previousTime) reset();
      const candidates = position ? pending : registered;
      const matches = ({ strokes }: (typeof registered)[number]) => {
        const stroke = strokes[position] as KeyStroke;
        const primary = stroke.cmd || stroke.meta || stroke.ctrl;
        return (
          !(event.editable && !primary) &&
          stroke.key === event.key.toLowerCase() &&
          event.meta === (stroke.meta || (stroke.cmd && mac)) &&
          event.ctrl === (stroke.ctrl || (stroke.cmd && !mac)) &&
          event.alt === stroke.alt &&
          (stroke.key === "?" || event.shift === stroke.shift)
        );
      };
      let matching = candidates.filter(matches);
      // Primary-modifier commands interrupt an unrelated navigation prefix.
      if (position && !matching.length && (event.meta || event.ctrl)) {
        reset();
        matching = registered.filter(matches);
      }
      const complete = matching.find(({ strokes }) => strokes.length === position + 1);
      if (complete) {
        reset();
        return { matched: complete.id, pending: false };
      }
      if (!matching.length) {
        reset();
        return { pending: false };
      }
      pending = matching;
      position++;
      previousTime = event.now;
      return { pending: true };
    },
  };
}
