#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync, writeFileSync } from "fs";
import { z } from "zod";
import { domainProfileSchema, scenarioSchema } from "../dist/engine/schema.js";
import { traceFileSchema } from "../dist/trace/schema.js";

// The runtime trace schema passes through optional event fields.
const exportedTraceSchema = traceFileSchema.extend({
  events: z.array(
    traceFileSchema.shape.events.element.extend({
      fault: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .optional(),
    }),
  ),
});

for (const [name, schema] of [
  ["domain-profile", domainProfileSchema],
  ["agent-scenario", scenarioSchema],
  ["agent-trace", exportedTraceSchema],
]) {
  const path = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  const value = {
    ...z.toJSONSchema(schema, { target: "draft-2020-12" }),
    "x-authored-by": "Codex GPT-6",
    ["$id"]: `urn:agent-reference:schema:${name}:0.1`,
  };
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== text) throw new Error(`${name} JSON Schema has drifted`);
  } else writeFileSync(path, text);
}
