// AUTHORED-BY Codex GPT-6.1-Sol
/** Allocate the whole hierarchy so file/folder and decoded-name collisions cannot overwrite data. */
export function pathAllocator(root: string) {
  const assigned = new Map<string, string>([["", "pod"]]);
  const used = new Set<string>(["pod"]);
  const unique = (base: string) => {
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base}~${n}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
  return (url: string, container: boolean): string => {
    const relative = new URL(url).pathname.slice(new URL(root).pathname.length);
    let path = assigned.get(relative);
    if (path !== undefined) return path + (container ? "/" : "");
    path = "pod";
    // Keep raw prefixes as identities, even though empty ZIP path segments disappear.
    // Otherwise a//file and a/file would silently become the same archive member.
    for (const match of relative.matchAll(/[^/]+/g)) {
      const raw = match[0];
      const end = match.index + raw.length;
      const folder = end < relative.length || container;
      const identity = relative.slice(0, end) + (folder ? "/" : "");
      const parent = assigned.get(relative.slice(0, match.index));
      if (parent !== undefined) path = parent;
      const previous = assigned.get(identity);
      if (previous !== undefined) {
        path = previous;
        continue;
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw).normalize("NFC");
      } catch {
        decoded = raw;
      }
      // These are ZIP path names, never filesystem paths or RDF identifiers.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: unsafe ZIP name bytes are removed.
      const clean = decoded.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/[. ]+$/g, "");
      const name = clean && clean !== "." && clean !== ".." ? clean : "_";
      path = unique(`${path}/${name}`);
      assigned.set(identity, path);
    }
    // A trailing empty segment can identify a distinct container after the last named one.
    if (!assigned.has(relative)) {
      path = unique(path === "pod" ? "pod/_" : path);
      assigned.set(relative, path);
    }
    return path + (container ? "/" : "");
  };
}
