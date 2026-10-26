// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-5.6 (Sol)
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { hostedClientIdConfig } from "./src/lib/hosted-client-id.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const plugins = [react(), tailwindcss()];
  if (!env.APP_ORIGIN) return { plugins };

  const hosted = hostedClientIdConfig(
    env,
    JSON.parse(readFileSync(new URL("./public/clientid.jsonld", import.meta.url), "utf8")),
  );

  return {
    ...hosted,
    plugins: [...plugins, ...(hosted.plugins ?? [])],
  };
});
