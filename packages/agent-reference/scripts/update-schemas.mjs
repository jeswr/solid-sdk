// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, writeFileSync } from "fs";
import { z } from "zod";
import { profileSchema, scenarioSchema } from "../dist/engine/schema.js";

const directory = new URL("../schemas/", import.meta.url);
mkdirSync(directory, { recursive: true });
for (const [name, schema] of [
  ["agent-profile", profileSchema],
  ["agent-scenario", scenarioSchema],
]) {
  writeFileSync(
    new URL(`${name}.schema.json`, directory),
    // biome-ignore lint/style/useNamingConvention: JSON Schema keyword
    `${JSON.stringify({ $comment: "AUTHORED-BY Codex GPT-6.1-Sol", ...z.toJSONSchema(schema, { io: "input" }) }, null, 2)}\n`,
  );
}
