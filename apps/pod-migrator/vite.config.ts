// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

type OriginEnvironment = Record<string, string | undefined>;

export function originEnvironment(layers: OriginEnvironment[]): OriginEnvironment {
  return layers.find((layer) => layer.APP_ORIGIN?.trim() || layer.VERCEL_URL?.trim()) ?? {};
}

function fileEnvironment(name: string): OriginEnvironment {
  try {
    return parseEnv(readFileSync(new URL(name, import.meta.url), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function deploymentOrigin(
  env: Record<string, string | undefined>,
  production = false,
): string {
  const raw =
    env.APP_ORIGIN?.trim() || (env.VERCEL_URL?.trim() ? `https://${env.VERCEL_URL.trim()}` : "");
  if (!raw && production) throw new Error("Set APP_ORIGIN or VERCEL_URL for a deployable build.");
  const url = new URL(raw || "http://localhost:5173");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !production)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "APP_ORIGIN must be an HTTPS origin without credentials, path, query or fragment (HTTP loopback is allowed for dev).",
    );
  }
  return url.origin;
}

export function clientIdDocument(origin: string) {
  return {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: `${origin}/clientid.jsonld`,
    client_name: "Pod Migrator",
    client_uri: `${origin}/`,
    redirect_uris: [`${origin}/callback/source`, `${origin}/callback/target`],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function clientDocumentPlugin(origin: string): Plugin {
  const body = `${JSON.stringify(clientIdDocument(origin), null, 2)}\n`;
  return {
    name: "pod-migrator-client-document",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/clientid.jsonld") {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/ld+json");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Cache-Control", "public, max-age=300");
        response.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "clientid.jsonld", source: body });
    },
  };
}

// Opt-in test mode substitutes modules at build time. No runtime demo/auth bypass.
function screenshotMocks(): Plugin {
  return {
    name: "pod-migrator-screenshot-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.endsWith("/src/App.tsx") && source === "./engine/index.js")
        return fileURLToPath(new URL("./e2e/engine.ts", import.meta.url));
      if (importer?.endsWith("/src/main.tsx") && source === "./auth/connections.js")
        return fileURLToPath(new URL("./e2e/connections.ts", import.meta.url));
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = originEnvironment([
    process.env,
    fileEnvironment(`.env.${mode}.local`),
    fileEnvironment(`.env.${mode}`),
    fileEnvironment(".env.local"),
    fileEnvironment(".env"),
  ]);
  const origin = deploymentOrigin(env, command === "build" && Boolean(process.env.VERCEL));
  if (mode === "screens" && command === "build")
    throw new Error("Screenshot mocks are development-only.");
  return {
    plugins: [
      react(),
      tailwindcss(),
      clientDocumentPlugin(origin),
      ...(mode === "screens" ? [screenshotMocks()] : []),
    ],
  };
});
