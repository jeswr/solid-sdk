// AUTHORED-BY Codex GPT-6
// Moved here from src/settlement/http.ts by Claude Opus 5.5: payment protocol bytes are
// foreign, and foreign bytes are parsed only in src/wire.
/** Bounded UTF-8 JSON with duplicate member names and non-finite numbers refused. */
export function strictJson(value: string | Uint8Array, maxBytes = 65_536): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("invalid size limit");
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  if (bytes.length > maxBytes) throw new Error("JSON too large");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const result: unknown = JSON.parse(text, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error("non-finite JSON number");
    return item;
  });
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') break;
        else i++;
      }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "x")) next++;
      const names = stack.at(-1);
      if (text[next] === ":" && names) {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (names.has(key)) throw new Error("duplicate JSON member");
        names.add(key);
      }
    }
  }
  return result;
}
