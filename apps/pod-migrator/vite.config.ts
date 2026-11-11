// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig, loadEnv } from "vite";

export function deploymentBasePath(value = "/"): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error(
      "APP_BASE_PATH must be an absolute path with a trailing slash and plain path segments.",
    );
  return value;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const suiteUrl = env.VITE_SUITE_URL?.trim() || "https://solid-suite.vercel.app";
  return {
    base: deploymentBasePath(env.CLIENT_BASE_PATH || env.APP_BASE_PATH),
    define: { "import.meta.env.VITE_SUITE_URL": JSON.stringify(suiteUrl) },
    plugins: [
      {
        name: "suite-redirect-default",
        transformIndexHtml: {
          order: "pre",
          handler: (html) => html.replaceAll("%VITE_SUITE_URL%", suiteUrl.replace(/\/+$/, "")),
        },
      },
    ],
  };
});
