// AUTHORED-BY Codex GPT-6.1-Sol
import type { CDPSession } from "playwright";
import { isPasswordLikeControl } from "./redact.js";

interface AXNode {
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
}
const readDOM = (cdp: CDPSession) => cdp.send("DOM.getDocument", { depth: -1, pierce: true });
type DOMNode = Awaited<ReturnType<typeof readDOM>>["root"];

export interface LiveControl {
  backend: number;
  protected: boolean;
  focused: boolean;
  value: string;
  start: number | null;
  end: number | null;
}

export function protectedAXNode(node: AXNode): boolean {
  return (
    /password/i.test(String(node.role?.value ?? "")) ||
    node.properties?.some((p) => String(p.name) === "protected" && p.value.value === true) ===
      true ||
    (/textbox|searchbox|combobox/i.test(String(node.role?.value ?? "")) &&
      isPasswordLikeControl({ "aria-label": String(node.name?.value ?? "") }))
  );
}

/** CDP exposes closed shadow trees, unlike Element.shadowRoot and page selectors. */
export async function collectLiveControls(cdp: CDPSession): Promise<{
  controls: LiveControl[];
  base: string;
  urls: string[];
}> {
  const { root } = await readDOM(cdp);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const ax = new Map(nodes.map((node) => [node.backendDOMNodeId, node]));
  const pending: DOMNode[] = [root];
  const controls: LiveControl[] = [];
  const urls: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    const node = pending[i];
    if (!node) continue;
    pending.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
    // Frames are blocked by the driver; never collect another document's credentials.
    const attributes = node.attributes ?? [];
    const attrs = Object.fromEntries(
      attributes.flatMap((name, j) => (j % 2 === 0 ? [[name, attributes[j + 1] ?? ""]] : [])),
    );
    for (const key of ["href", "action", "formaction"]) if (attrs[key]) urls.push(attrs[key]);
    const accessible = ax.get(node.backendNodeId);
    const protectedControl =
      isPasswordLikeControl(attrs) || (accessible !== undefined && protectedAXNode(accessible));
    if (
      !/^(INPUT|TEXTAREA|SELECT)$/.test(node.nodeName) &&
      !/^(textbox|searchbox)$/.test(attrs.role ?? "") &&
      !(accessible !== undefined && protectedAXNode(accessible))
    )
      continue;
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backendNodeId });
    if (!object.objectId) throw new Error("Credential control could not be resolved.");
    try {
      const result = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function() {
          return { value: typeof this.value === 'string' ? this.value : this.textContent || '',
            focused: this.getRootNode().activeElement === this,
            start: this.selectionStart ?? null, end: this.selectionEnd ?? null };
        }`,
        returnByValue: true,
      });
      if (result.exceptionDetails || !result.result.value)
        throw new Error("Credential control could not be read.");
      controls.push({
        ...result.result.value,
        backend: node.backendNodeId,
        protected: protectedControl,
      });
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    }
  }
  return { controls, urls, base: root.baseURL ?? root.documentURL ?? "about:blank" };
}

/** The printable spellings accepted by Playwright keyboard.press (US layout). */
export function pressedText(key: string): {
  text?: string;
  paste?: boolean;
  unsupported?: boolean;
} {
  const parts: string[] = [];
  let token = "";
  for (const character of key) {
    if (character === "+" && token) {
      parts.push(token);
      token = "";
    } else token += character;
  }
  parts.push(token);
  const last = parts.pop() ?? "";
  const modifiers = parts.map((part) =>
    part.replace(/^(Shift|Control|Alt|Meta)(?:Left|Right)$/, "$1"),
  );
  if (modifiers.some((part) => !/^(Shift|Control|Alt|Meta|ControlOrMeta)$/.test(part)))
    return { unsupported: true };
  const shift = modifiers.includes("Shift");
  const command = modifiers.some((part) => /^(Control|Meta|ControlOrMeta)$/.test(part));
  if ((command && /^(v|KeyV)$/i.test(last)) || (shift && last === "Insert")) return { paste: true };
  if (command || modifiers.includes("Alt")) return {};
  if (last.length === 1) return { text: last };
  if (last === "Enter" || last === "NumpadEnter") return { text: "\n" };
  if (/^Numpad[0-9]$/.test(last)) return { text: shift ? last.slice(6) : undefined };
  if (/^Key[A-Z]$/.test(last)) return { text: shift ? last.slice(3) : last.slice(3).toLowerCase() };
  if (/^Digit[0-9]$/.test(last)) {
    const digit = last.slice(5);
    return { text: shift ? ")!@#$%^&*("[Number(digit)] : digit };
  }
  const punctuation: Record<string, string> = {
    Space: "  ",
    Backquote: "`~",
    Minus: "-_",
    Equal: "=+",
    BracketLeft: "[{",
    BracketRight: "]}",
    Backslash: "\\|",
    Semicolon: ";:",
    Quote: "'\"",
    Comma: ",<",
    Period: ".>",
    Slash: "/?",
    NumpadDivide: "//",
    NumpadMultiply: "**",
    NumpadSubtract: "--",
    NumpadAdd: "++",
    NumpadDecimal: "..",
  };
  return { text: punctuation[last]?.[shift ? 1 : 0] };
}
