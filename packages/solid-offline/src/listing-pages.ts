// AUTHORED-BY Codex GPT-6.1-Sol
/** Resolve next-page links without splitting commas inside targets or quoted parameters. */
export function nextPages(url: string, header: string | null): string[] {
  const pages: string[] = [];
  for (const link of (header ?? '').matchAll(/<([^<>]*)>((?:[^<",]|"(?:[^"\\]|\\.)*")*)/g)) {
    const params = new Map<string, string>();
    for (const param of (link[2] ?? '').matchAll(
      /;\s*([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/g,
    )) {
      const name = param[1]?.toLowerCase() ?? '';
      if (!params.has(name)) params.set(name, (param[2] ?? param[3] ?? '').replace(/\\(.)/g, '$1'));
    }
    if (!params.get('rel')?.toLowerCase().split(/\s+/).includes('next')) continue;
    const anchor = params.get('anchor');
    if (anchor !== undefined && (!URL.canParse(anchor, url) || new URL(anchor, url).href !== url))
      continue;
    const target = link[1];
    if (target !== undefined && URL.canParse(target, url)) pages.push(new URL(target, url).href);
  }
  return pages;
}
