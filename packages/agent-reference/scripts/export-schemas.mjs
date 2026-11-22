#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync, writeFileSync } from "fs";
import { z } from "zod";
import { domainProfileSchema, scenarioSchema } from "../dist/engine/schema.js";
import { traceFileShapeSchema } from "../dist/trace/schema.js";
import { SCENARIO_CONTEXT } from "../dist/wire/store-contexts.js";

// Keep the runtime schemas on 0.1. The authoring files add a pinned JSON-LD envelope.
const authoringSchema = (schema, kind) =>
  schema.safeExtend({
    "@context": z.literal(SCENARIO_CONTEXT),
    schema: z.literal(`agent-${kind}/0.2`),
  });

// The runtime trace schema passes through optional event fields.
const exportedTraceSchema = traceFileShapeSchema.extend({
  events: z.array(
    traceFileShapeSchema.shape.events.element.extend({
      fault: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .optional(),
    }),
  ),
});

for (const [name, schema, version] of [
  ["domain-profile", authoringSchema(domainProfileSchema, "profile"), "0.2"],
  ["agent-scenario", authoringSchema(scenarioSchema, "scenario"), "0.2"],
  ["agent-trace", exportedTraceSchema, "0.1"],
]) {
  const path = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  const value = {
    ...z.toJSONSchema(schema, { target: "draft-2020-12" }),
    ...(name === "agent-trace" ? { not: { required: ["linked", "linkedTable"] } } : {}),
    "x-authored-by": "Codex GPT-6",
    ["$id"]: `urn:agent-reference:schema:${name}:${version}`,
  };
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== text) throw new Error(`${name} JSON Schema has drifted`);
  } else writeFileSync(path, text);
}
