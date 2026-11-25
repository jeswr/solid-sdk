// AUTHORED-BY Codex GPT-6.1-Sol
export function plainTextLinks(text: string) {
  const seen = new Map<string, number>();
  return text.split(/(https?:\/\/[^\s<>]+)/gi).map((part) => {
    const occurrence = (seen.get(part) ?? 0) + 1;
    seen.set(part, occurrence);
    if (/^https?:\/\//i.test(part)) {
      try {
        const url = new URL(part);
        if (url.protocol === "http:" || url.protocol === "https:")
          return (
            <a
              key={`${part}-${occurrence}`}
              href={url.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {part}
            </a>
          );
      } catch {
        /* Malformed URLs remain text. */
      }
    }
    return part;
  });
}
