// AUTHORED-BY Codex GPT-6
/** Build-time settings: public links and client identity always retain their deployed https URL. */
export const PUBLIC_SUITE_URL = (
  process.env.NEXT_PUBLIC_PUBLIC_SUITE_URL ?? "https://solid-suite.vercel.app"
).replace(/\/+$/, "");
export const CLIENT_ID_URL =
  process.env.NEXT_PUBLIC_CLIENT_ID_URL ??
  `${PUBLIC_SUITE_URL}/.well-known/solid-client-id-mobile.jsonld`;

/** iOS and Android consume one export; the live local scheme wins once mounted in the WebView. */
export function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native" && typeof window !== "undefined")
    return `${window.location.protocol}//${window.location.host}`;
  return process.env.NEXT_PUBLIC_APP_BASE_URL ?? PUBLIC_SUITE_URL;
}
