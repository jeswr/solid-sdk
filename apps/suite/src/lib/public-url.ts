// AUTHORED-BY Codex GPT-6.1-Sol
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
