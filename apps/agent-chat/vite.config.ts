// AUTHORED-BY Claude Opus 5.5
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Pages builds pass a base path; the artifact build is one self-contained file. */
export function basePath(value = "/"): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error("APP_BASE_PATH must be an absolute path with a trailing slash.");
  return value;
}

export default defineConfig(({ mode }) => ({
  base:
    mode === "artifact"
      ? "./"
      : basePath(process.env.CLIENT_BASE_PATH || process.env.APP_BASE_PATH),
  plugins: [react()],
  build:
    mode === "artifact"
      ? {
          outDir: "dist-artifact",
          assetsInlineLimit: 100_000_000,
          cssCodeSplit: false,
          modulePreload: false,
        }
      : {},
}));
