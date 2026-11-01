// AUTHORED-BY Codex GPT-6.1-Sol
/** Insert an OAuth well-known path before the identifier path (RFC 8414 / RFC 9728). */
export function metadataUrl(identifier: string, suffix: string): string {
  const url = new URL(identifier);
  return `${url.origin}/.well-known/${suffix}${url.pathname.replace(/\/$/u, "")}`;
}
