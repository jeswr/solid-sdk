// AUTHORED-BY Codex GPT-5.6 (Sol)

import type { UserConfig } from "vite";

/** Build the hosted document and browser identity from the same trusted origin. */
export function hostedClientIdConfig(
  env: Record<string, string>,
  template: Record<string, unknown>,
) {
  if (!env.APP_ORIGIN) return {};

  const url = new URL(env.APP_ORIGIN);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "APP_ORIGIN must use https: (http: is allowed only for localhost, 127.0.0.1, or [::1])",
    );
  }
  const origin = url.origin;
  const clientId = `${origin}/clientid.jsonld`;
  const document = {
    ...template,
    client_id: clientId,
    client_uri: origin,
    redirect_uris: [`${origin}/callback.html`],
    post_logout_redirect_uris: [origin],
  };

  return {
    define: {
      "import.meta.env.VITE_CLIENT_ID": JSON.stringify(env.VITE_CLIENT_ID || clientId),
    },
    plugins: [
      {
        name: "hosted-client-id",
        apply: "build",
        generateBundle(this: {
          emitFile: (asset: { type: "asset"; fileName: string; source: string }) => unknown;
        }) {
          this.emitFile({
            type: "asset",
            fileName: "clientid.jsonld",
            source: `${JSON.stringify(document, null, 2)}\n`,
          });
        },
      },
    ],
  } satisfies UserConfig;
}
