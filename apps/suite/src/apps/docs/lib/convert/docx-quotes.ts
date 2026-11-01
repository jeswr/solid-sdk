// AUTHORED-BY Codex
/** Native Word styles retain quote boundaries and their position among list ancestors. */
export interface QuoteAncestor {
  id: number;
  lists: number;
}

export function quoteStyleName(quotes: readonly QuoteAncestor[], style: string): string {
  return `Suite Quote ${quotes.map(({ id, lists }) => `${id}.${lists}`).join("-")} ${style}`;
}

export function readQuoteStyle(name: string) {
  const match = /^suite quote ((?:\d+\.\d+-)*\d+\.\d+) (.+)$/i.exec(name);
  if (!match) return undefined;
  return {
    quotes: (match[1] as string).split("-").map((part) => {
      const [id, lists] = part.split(".");
      return { id: Number(id), lists: Number(lists) };
    }),
    style: match[2] as string,
  };
}

/** Reuse only the same quote ancestry; adjacent sibling quotes must open fresh elements. */
export function quotePaths(
  lists: string[],
  quotes: readonly QuoteAncestor[],
  previous: readonly QuoteAncestor[],
): string[] {
  const paths: string[] = [];
  let shared = 0;
  while (shared < quotes.length && quotes[shared]?.id === previous[shared]?.id) shared++;
  for (let index = 0; index <= lists.length; index++) {
    quotes.forEach((quote, depth) => {
      // If Word removed a preceding list, retain its detached quotation.
      if (Math.min(quote.lists, lists.length) === index)
        paths.push(`blockquote${depth < shared ? "" : ":fresh"}`);
    });
    if (index < lists.length) paths.push(lists[index] as string);
  }
  return paths;
}
