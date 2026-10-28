// AUTHORED-BY Codex GPT-6

// Only the CLI transport validates and anonymizes off-pod profile redirects.
// Keep the fetch adapter's manual policy for ordinary injected fetch functions.
const guardedTransports = new WeakSet<typeof fetch>();

export function withProfileRedirects(transport: typeof fetch): typeof fetch {
  guardedTransports.add(transport);
  return transport;
}

export function handlesProfileRedirects(transport: typeof fetch): boolean {
  return guardedTransports.has(transport);
}
