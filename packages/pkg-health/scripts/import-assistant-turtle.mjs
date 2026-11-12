// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { serializeNanopublications } from "@jeswr/pkg-memory";
import { importAssistantTurtle } from "../dist/index.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      owner: { type: "string" },
      "assistant-iri": { type: "string" },
      "assistant-label": { type: "string" },
      batch: { type: "string" },
      "generated-at": { type: "string" },
    },
  });
  if (
    positionals.length !== 2 ||
    !values.owner ||
    !values["assistant-iri"] ||
    !values["assistant-label"] ||
    !values.batch
  )
    throw new Error();
  const result = await importAssistantTurtle(await readFile(positionals[0], "utf8"), {
    owner: values.owner,
    assistant: { iri: values["assistant-iri"], label: values["assistant-label"] },
    batchId: values.batch,
    generatedAt: values["generated-at"] ?? new Date().toISOString(),
  });
  await writeFile(positionals[1], await serializeNanopublications(result.value), "utf8");
  console.log(
    JSON.stringify({ imported: result.value.nanopubs.length, skipped: result.skipped.count }),
  );
} catch {
  // Neither parser diagnostics nor paths/arguments may disclose private values.
  console.error("Assistant health import failed");
  process.exitCode = 1;
}
