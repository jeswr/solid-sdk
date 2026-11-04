// AUTHORED-BY Codex GPT-6.1-Sol
export const SYSTEM_KEYS = [
  "inbox",
  "starred",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
] as const;
export function folderKey(iri: string): string {
  const url = new URL(iri);
  const segment = url.pathname.split("/").pop() as string;
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash !== "#it" ||
    !url.pathname.includes("/folders/") ||
    !segment.endsWith(".ttl")
  )
    throw new TypeError("Invalid folder");
  const slug = segment.slice(0, -4);
  if (slug.startsWith("system:") && SYSTEM_KEYS.some((key) => slug === `system:${key}`))
    return slug.slice(7);
  if (!/^[\w~.!'()*-]+$/.test(slug) || slug === "." || slug === "..")
    throw new TypeError("Invalid folder");
  return `label:${encodeURIComponent(slug)}`;
}
export function folderIriFromKey(root: string, key: string): string {
  if (SYSTEM_KEYS.some((id) => id === key))
    return new URL(`folders/system:${key}.ttl#it`, root).href;
  if (!key.startsWith("label:")) throw new TypeError("Invalid folder key");
  const slug = decodeURIComponent(key.slice(6));
  const iri = new URL(`folders/${slug}.ttl#it`, root).href;
  if (folderKey(iri) !== key) throw new TypeError("Invalid folder key");
  return iri;
}
