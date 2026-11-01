// AUTHORED-BY Codex GPT-5.6 (Sol)
// AUTHORED-BY Codex GPT-6

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
  const basePath = env.CLIENT_BASE_PATH || "/";
  if (!/^\/(?:[^?#\\]*\/)?$/.test(basePath) || basePath.startsWith("//")) {
    throw new Error("CLIENT_BASE_PATH must be an absolute path ending in /");
  }
  const appUrl = new URL(basePath, `${origin}/`).href;
  const clientUri = basePath === "/" ? origin : appUrl;
  const clientId = `${appUrl}clientid.jsonld`;
  const document = {
    ...template,
    client_id: clientId,
    client_uri: clientUri,
    redirect_uris: [`${appUrl}callback.html`],
    post_logout_redirect_uris: [clientUri],
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
