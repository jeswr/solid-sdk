// AUTHORED-BY Codex (GPT-6.1 Sol)
import { ELEMENT_TYPES, LIMITS, type Scene } from "./types.js";

const originals = new WeakMap<Scene, { source: string; canonical: string }>();
function fail(message: string): never {
  throw new TypeError(`Invalid Excalidraw scene: ${message}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** No CSS URLs, variables or paint servers may enter a portable SVG. */
export function isColour(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|(?:rgb|rgba|hsl|hsla|oklch)\([\d\s.,%+\-/]+\))$/i.test(
      value,
    )
  );
}
function preflight(json: string) {
  if (json.length > LIMITS.bytes || new TextEncoder().encode(json).length > LIMITS.bytes)
    fail("file is too large");
  let separators = 0;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const c of json) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "," && ++separators > LIMITS.nodes) fail("document complexity limit");
    else if (c === "{" || c === "[") {
      if (++depth > LIMITS.depth) fail("nesting is too deep");
    } else if (c === "}" || c === "]") depth--;
  }
}
export function validateScene(value: unknown): asserts value is Scene {
  let count = 0;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (stack.length) {
    const entry = stack.pop() as { value: unknown; depth: number };
    if (++count > LIMITS.nodes || entry.depth > LIMITS.depth) fail("document complexity limit");
    const v = entry.value;
    if (typeof v === "number" && !Number.isFinite(v)) fail("non-finite number");
    if (v && typeof v === "object") {
      if (seen.has(v)) fail("cyclic or shared object");
      seen.add(v);
      if (
        Object.getPrototypeOf(v) !== Object.prototype &&
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) !== null
      )
        fail("non-JSON object");
      if (Array.isArray(v) && v.length > LIMITS.nodes - count) fail("document complexity limit");
      const children = Object.values(v);
      if (children.length > LIMITS.nodes - count || stack.length + children.length > LIMITS.nodes)
        fail("document complexity limit");
      for (const child of children) stack.push({ value: child, depth: entry.depth + 1 });
    } else if (v !== null && !["number", "boolean", "string"].includes(typeof v))
      fail("non-JSON value");
  }
  if (
    !record(value) ||
    value.type !== "excalidraw" ||
    value.version !== 2 ||
    !Array.isArray(value.elements) ||
    !record(value.appState) ||
    !record(value.files)
  )
    fail("expected type excalidraw, version 2, elements, appState and files");
  if (value.elements.length > LIMITS.elements) fail("too many elements");
  if (
    value.appState.viewBackgroundColor !== undefined &&
    typeof value.appState.viewBackgroundColor !== "string"
  )
    fail("invalid background colour");
  const ids = new Set<string>();
  for (const e of value.elements) {
    if (
      !record(e) ||
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 256 ||
      ids.has(e.id) ||
      typeof e.type !== "string" ||
      !e.type ||
      e.type.length > 100
    )
      fail("invalid or duplicate element identity");
    ids.add(e.id);
    // Future element types remain opaque; never interpret their properties.
    if (!(ELEMENT_TYPES as readonly string[]).includes(e.type)) continue;
    for (const key of ["x", "y", "width", "height", "angle"])
      if (
        typeof e[key] !== "number" ||
        !Number.isFinite(e[key]) ||
        Math.abs(e[key] as number) > LIMITS.coordinate
      )
        fail(`invalid ${key}`);
    if ((e.width as number) < 0 || (e.height as number) < 0) fail("negative dimensions");
    if (typeof e.strokeColor !== "string" || typeof e.backgroundColor !== "string")
      fail("invalid element colour");
    if (
      typeof e.strokeWidth !== "number" ||
      e.strokeWidth < 0 ||
      e.strokeWidth > 100 ||
      typeof e.opacity !== "number" ||
      e.opacity < 0 ||
      e.opacity > 100
    )
      fail("invalid style");
    for (const key of ["version", "versionNonce", "updated"])
      if (!Number.isSafeInteger(e[key]) || (e[key] as number) < 0) fail(`invalid ${key}`);
    if (
      typeof e.isDeleted !== "boolean" ||
      !Array.isArray(e.groupIds) ||
      e.groupIds.length > 100 ||
      e.groupIds.some((id) => typeof id !== "string" || id.length > 256)
    )
      fail("invalid element flags");
    if (e.points !== undefined || ["line", "arrow", "freedraw"].includes(e.type)) {
      if (
        !Array.isArray(e.points) ||
        e.points.length < 1 ||
        e.points.length > LIMITS.points ||
        e.points.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some(
              (n) =>
                typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > LIMITS.coordinate,
            ),
        )
      )
        fail("invalid points");
    }
    if (
      e.type === "text" &&
      (typeof e.text !== "string" ||
        typeof e.fontSize !== "number" ||
        e.fontSize <= 0 ||
        e.fontSize > 1000)
    )
      fail("invalid text");
    if (e.type === "image" && e.fileId !== null && typeof e.fileId !== "string")
      fail("invalid image reference");
  }
}
export function parseScene(json: string): Scene {
  if (typeof json !== "string") fail("expected JSON text");
  preflight(json);
  const source = json;
  json = json.replace(/^\uFEFF/, "");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return fail("malformed JSON");
  }
  if (record(value) && Array.isArray(value.elements))
    for (const element of value.elements)
      if (
        record(element) &&
        (ELEMENT_TYPES as readonly unknown[]).includes(element.type) &&
        element.updated === undefined
      )
        element.updated = 0;
  validateScene(value);
  originals.set(value, { source, canonical: JSON.stringify(value) });
  return value;
}
export function serializeScene(scene: Scene): string {
  validateScene(scene);
  const canonical = JSON.stringify(scene);
  const original = originals.get(scene);
  const json = original?.canonical === canonical ? original.source : canonical;
  if (new TextEncoder().encode(json).length > LIMITS.bytes) fail("file is too large");
  return json;
}
export function emptyScene(): Scene {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://jeswr.org/",
    elements: [],
    appState: {},
    files: {},
  };
}
/** Bound streamed pod bytes before buffering or parsing them. */
export async function parseSceneStream(body: ReadableStream<Uint8Array> | null): Promise<Scene> {
  if (!body) throw new TypeError("Missing Excalidraw body");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0,
    json = "",
    complete = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMITS.bytes) throw new TypeError("Excalidraw file is too large");
      json += decoder.decode(part.value, { stream: true });
    }
    json += decoder.decode();
    complete = true;
    return parseScene(json);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
