#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { pathToFileURL } from "node:url";
import { main } from "../dist/render-card.js";

export { renderCard } from "../dist/render-card.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "render-card: rendering failed. Check arguments, descriptor configuration, and container access.",
    );
    process.exitCode = 1;
  });
}
