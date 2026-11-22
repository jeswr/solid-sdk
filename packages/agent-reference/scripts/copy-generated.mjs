// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { cpSync } from "fs";

cpSync(
  new URL("../src/generated/", import.meta.url),
  new URL("../dist/generated/", import.meta.url),
  { recursive: true },
);
