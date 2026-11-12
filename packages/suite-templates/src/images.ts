// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
export const isUrlAttribute = (key: string) =>
  ["src", "href", "poster", "cite", "action", "formaction", "xlink:href"].includes(key) ||
  key.startsWith("data-");

/** Rewrite URL leaves in editor JSON, preserving ordinary text. */
export function relocateAttributes<T>(value: T, relocate: (iri: string) => string, key = ""): T {
  if (typeof value === "string") return (isUrlAttribute(key) ? relocate(value) : value) as T;
  if (Array.isArray(value))
    return value.map((item) => relocateAttributes(item, relocate, key)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, relocateAttributes(value, relocate, key)]),
    ) as T;
  return value;
}

/** Copy each in-pod image once, then relocate all references to it (including links). */
export async function copyTemplateImages<T>(
  value: T,
  options: {
    root: string;
    read: (url: string) => Promise<{ data: ArrayBuffer; contentType: string }>;
    upload: (data: ArrayBuffer, contentType: string) => Promise<string>;
  },
): Promise<T> {
  const sources = new Set<string>();
  // External images remain external; never send them pod credentials.
  const inPod = (iri: string) => {
    try {
      return assertWithinPodScope(options.root, iri);
    } catch {
      return undefined;
    }
  };
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const object = node as { type?: string; attrs?: { src?: unknown }; content?: unknown[] };
    const source = typeof object.attrs?.src === "string" ? inPod(object.attrs.src) : undefined;
    if (object.type === "image" && source) sources.add(source);
    object.content?.forEach(visit);
  }
  visit(value);
  const mapping = new Map<string, string>();
  for (const source of sources) {
    const image = await options.read(source);
    mapping.set(source, await options.upload(image.data, image.contentType));
  }
  // Match references by their normalized form too, so an equivalent spelling is not left behind.
  return relocateAttributes(
    value,
    (iri) => mapping.get(iri) ?? mapping.get(inPod(iri) ?? "") ?? iri,
  );
}
export function templatePreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}
