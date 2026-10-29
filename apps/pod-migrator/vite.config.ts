// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

type OriginEnvironment = Record<string, string | undefined>;

export function originEnvironment(layers: OriginEnvironment[]): OriginEnvironment {
  return Object.assign(
    {},
    ...layers
      .toReversed()
      .map((layer) =>
        Object.fromEntries(Object.entries(layer).filter(([, value]) => value?.trim())),
      ),
  );
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
  const raw = env.APP_ORIGIN?.trim();
  if (!raw && production) throw new Error("Set APP_ORIGIN for a deployable build.");
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

export function deploymentBasePath(value = "/"): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error(
      "APP_BASE_PATH must be an absolute path with a trailing slash and plain path segments.",
    );
  return value;
}

export function clientIdDocument(origin: string, base = "/") {
  const app = `${origin}${deploymentBasePath(base)}`;
  return {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: `${app}clientid.jsonld`,
    client_name: "Pod Migrator",
    client_uri: app,
    redirect_uris: [`${app}callback/source`, `${app}callback/target`],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function clientDocumentPlugin(origin: string, base = "/"): Plugin {
  const body = `${JSON.stringify(clientIdDocument(origin, base), null, 2)}\n`;
  return {
    name: "pod-migrator-client-document",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== `${base}clientid.jsonld`) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/ld+json");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Cache-Control", "public, max-age=300");
        response.end(body);
      });
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const index = bundle["index.html"];
        if (index?.type !== "asset") throw new Error("Missing built index.html");
        for (const fileName of [
          "404.html",
          "callback/source/index.html",
          "callback/target/index.html",
        ])
          this.emitFile({ type: "asset", fileName, source: index.source });
        this.emitFile({ type: "asset", fileName: "clientid.jsonld", source: body });
      },
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
  const origin = deploymentOrigin(env, command === "build" && Boolean(env.APP_ORIGIN));
  // scripts/build-pages.mjs passes the Pages base as CLIENT_BASE_PATH (and --base).
  const base = deploymentBasePath(env.CLIENT_BASE_PATH || env.APP_BASE_PATH);
  if (mode === "screens" && command === "build")
    throw new Error("Screenshot mocks are development-only.");
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      clientDocumentPlugin(origin, base),
      ...(mode === "screens" ? [screenshotMocks()] : []),
    ],
  };
});
