// AUTHORED-BY Codex GPT-6
/** Only a signed build setting may select the relay; pod metadata cannot supply it. */
export function pushRelayUrl(value = process.env.NEXT_PUBLIC_PUSH_RELAY_URL): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || value !== url.origin)
    throw new TypeError("Push relay must be a canonical HTTPS origin");
  return value;
}
