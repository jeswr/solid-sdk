// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-5.6 (Sol)
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const plugins = [react(), tailwindcss()];
  if (!env.APP_ORIGIN) return { plugins };

  const url = new URL(env.APP_ORIGIN);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("APP_ORIGIN must be an http(s) origin");
  }
  const origin = url.origin;
  const clientId = `${origin}/clientid.jsonld`;
  const document = {
    ...JSON.parse(readFileSync(new URL("./public/clientid.jsonld", import.meta.url), "utf8")),
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
      ...plugins,
      {
        name: "hosted-client-id",
        apply: "build",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "clientid.jsonld",
            source: `${JSON.stringify(document, null, 2)}\n`,
          });
        },
      },
    ],
  };
});
