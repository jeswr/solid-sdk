// AUTHORED-BY Codex (GPT-6.1 Sol)
/** Lower-cases, trims and dedupes a tag list, dropping blanks (order-preserving). */
export function normaliseKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Parse a comma/newline-separated keyword string into a clean list. */
export function parseKeywordsInput(input: string): string[] {
  return normaliseKeywords(input.split(/[,\n]/));
}
