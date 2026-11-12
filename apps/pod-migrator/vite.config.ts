// AUTHORED-BY Codex GPT-6.1-Sol
import { defineConfig, loadEnv } from "vite";

export function deploymentBasePath(value = "/"): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error(
      "APP_BASE_PATH must be an absolute path with a trailing slash and plain path segments.",
    );
  return value;
}

/** The suite origin (and optional path) to redirect to: HTTPS, no credentials, query or hash. */
export function suiteRedirectBase(value = ""): string {
  const url = new URL(value.trim() || "https://solid-suite.vercel.app");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("VITE_SUITE_URL must be an HTTPS URL without credentials, query or hash.");
  return url.href.replace(/\/+$/, "");
}

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const suiteUrl = suiteRedirectBase(env.VITE_SUITE_URL);
  return {
    base: deploymentBasePath(env.CLIENT_BASE_PATH || env.APP_BASE_PATH),
    define: { "import.meta.env.VITE_SUITE_URL": JSON.stringify(suiteUrl) },
    plugins: [
      {
        name: "suite-redirect-default",
        transformIndexHtml: {
          order: "pre",
          handler: (html) =>
            html.replaceAll(
              "%VITE_SUITE_URL%",
              suiteUrl.replace(/[&"'<>]/g, (char) => htmlEscapes[char] ?? char),
            ),
        },
      },
    ],
  };
});
