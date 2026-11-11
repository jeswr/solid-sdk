// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { clientIdDocumentUrl, publicBaseUrl } from "../src/lib/public-url.ts";
import { pushRelayUrl } from "../src/shell/push/config.ts";

export function nativeSettings(env) {
  const publicSuiteUrl = publicBaseUrl(
    env.NEXT_PUBLIC_PUBLIC_SUITE_URL ?? env.PUBLIC_SUITE_URL ?? "https://solid-suite.vercel.app",
  );
  const clientIdUrl = clientIdDocumentUrl(
    env.NEXT_PUBLIC_CLIENT_ID_URL ??
      env.CLIENT_ID_URL ??
      `${publicSuiteUrl.replace(/\/$/, "")}/.well-known/solid-client-id-mobile.jsonld`,
  );
  const appBaseUrl = env.NEXT_PUBLIC_APP_BASE_URL ?? env.APP_BASE_URL ?? "https://localhost";
  for (const value of [publicSuiteUrl, clientIdUrl]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Native public and Client ID URLs must be https");
  }
  if (!["https://localhost", "capacitor://localhost"].includes(appBaseUrl))
    throw new Error("Native APP_BASE_URL must be a bundled local origin");
  return {
    target: "native",
    appBaseUrl,
    publicSuiteUrl,
    clientIdUrl,
    pushRelayUrl: pushRelayUrl(env.NEXT_PUBLIC_PUSH_RELAY_URL ?? env.PUSH_RELAY_URL ?? ""),
  };
}
