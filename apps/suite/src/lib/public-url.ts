// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/** A public base must remain safe to concatenate with navigation and identity paths. */
export function publicBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href.includes("?") ||
    url.href.includes("#")
  )
    throw new Error("Public base URLs must be https without userinfo, queries or fragments");
  return url.href.replace(/\/+$/, "");
}

/** A Solid-OIDC client_id dereferences to its document, so it must be a bare https URL. */
export function clientIdDocumentUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.href.includes("#"))
    throw new Error("Client ID URLs must be https without userinfo or fragments");
  return url.href;
}
