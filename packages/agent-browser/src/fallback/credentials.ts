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
  value: string;
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
  const pending: { node: DOMNode; protected: boolean }[] = [{ node: root, protected: false }];
  const controls: LiveControl[] = [];
  const urls: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    if (!entry) continue;
    const { node } = entry;
    // Frames are blocked by the driver; never collect another document's credentials.
    const attributes = node.attributes ?? [];
    const attrs = Object.fromEntries(
      attributes.flatMap((name, j) => (j % 2 === 0 ? [[name, attributes[j + 1] ?? ""]] : [])),
    );
    for (const key of ["href", "action", "formaction"]) if (attrs[key]) urls.push(attrs[key]);
    const accessible = ax.get(node.backendNodeId);
    const isControl =
      /^(INPUT|TEXTAREA|SELECT)$/.test(node.nodeName) ||
      /^(textbox|searchbox|combobox)$/.test(attrs.role ?? "") ||
      (accessible !== undefined && protectedAXNode(accessible));
    const protectedControl =
      entry.protected ||
      (isControl &&
        (isPasswordLikeControl(attrs) ||
          (accessible !== undefined && protectedAXNode(accessible))));
    pending.push(
      ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].map((node) => ({
        node,
        protected: protectedControl,
      })),
    );
    if (!isControl) continue;
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node.backendNodeId });
    if (!object.objectId) throw new Error("Credential control could not be resolved.");
    try {
      const result = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function() {
          return { value: typeof this.value === 'string' ? this.value : this.textContent || '' };
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

/** Resolve actual focus afresh, descending through CDP-only closed shadow roots. */
export async function focusedElement(cdp: CDPSession): Promise<{
  backend: number;
  protected: boolean;
  value: string;
}> {
  const objects = new Set<string>();
  try {
    const active = await cdp.send("Runtime.evaluate", { expression: "document.activeElement" });
    if (active.exceptionDetails || !active.result.objectId)
      throw new Error("Focused element is unknown.");
    let objectId = active.result.objectId;
    let protectedControl = false;
    objects.add(objectId);
    for (let depth = 0; depth < 100; depth++) {
      const { node } = await cdp.send("DOM.describeNode", { objectId, depth: 1, pierce: true });
      const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
        backendNodeId: node.backendNodeId,
        fetchRelatives: false,
      });
      const ax = nodes.find((item) => item.backendDOMNodeId === node.backendNodeId);
      if (!ax) throw new Error("Focused accessibility state is unknown.");
      const attributes = node.attributes ?? [];
      const attrs = Object.fromEntries(
        attributes.flatMap((name, i) => (i % 2 === 0 ? [[name, attributes[i + 1] ?? ""]] : [])),
      );
      // A masked accessible host may own an otherwise ordinary-looking inner input.
      protectedControl ||=
        protectedAXNode(ax) ||
        ((/^(INPUT|TEXTAREA|SELECT)$/.test(node.nodeName) ||
          /^(textbox|searchbox|combobox)$/.test(String(ax.role?.value ?? attrs.role ?? ""))) &&
          isPasswordLikeControl(attrs));
      let inner: string | undefined;
      for (const root of node.shadowRoots ?? []) {
        const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: root.backendNodeId });
        if (!object.objectId) throw new Error("Shadow focus is unknown.");
        objects.add(object.objectId);
        const active = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: "function() { return this.activeElement; }",
        });
        if (active.exceptionDetails) throw new Error("Shadow focus is unknown.");
        if (active.result.objectId) {
          if (inner) throw new Error("Shadow focus is ambiguous.");
          inner = active.result.objectId;
          objects.add(inner);
        } else if (active.result.subtype !== "null") throw new Error("Shadow focus is unknown.");
      }
      if (inner) {
        objectId = inner;
        continue;
      }
      protectedControl ||= isPasswordLikeControl(attrs);
      const state = await cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
          return { connected: this.isConnected,
            value: typeof this.value === 'string' ? this.value : this.textContent || '' };
        }`,
        returnByValue: true,
      });
      if (state.exceptionDetails || state.result.value?.connected !== true)
        throw new Error("Focused element is unavailable.");
      return {
        backend: node.backendNodeId,
        value: state.result.value.value,
        protected: protectedControl,
      };
    }
    throw new Error("Shadow focus depth exceeded.");
  } finally {
    await Promise.all(
      [...objects].map((objectId) =>
        cdp.send("Runtime.releaseObject", { objectId }).catch(() => undefined),
      ),
    );
  }
}
