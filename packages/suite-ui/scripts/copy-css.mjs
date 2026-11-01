// AUTHORED-BY Codex GPT-6.1-Sol
import { cpSync, mkdirSync } from "node:fs";

const destination = new URL("../dist/styles/", import.meta.url);
mkdirSync(destination, { recursive: true });
cpSync(new URL("../src/styles/", import.meta.url), destination, { recursive: true });
cpSync(
  new URL("../src/font-assets/", import.meta.url),
  new URL("../dist/font-assets/", import.meta.url),
  {
    recursive: true,
  },
);
