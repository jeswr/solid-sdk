// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
    !values.batch ||
    resolve(positionals[0]) === resolve(positionals[1])
  )
    throw new Error();
  const result = await importAssistantTurtle(await readFile(positionals[0], "utf8"), {
    owner: values.owner,
    assistant: { iri: values["assistant-iri"], label: values["assistant-label"] },
    batchId: values.batch,
    generatedAt: values["generated-at"] ?? new Date().toISOString(),
  });
  // Special-category data: owner-only mode, and "wx" refuses an existing path,
  // including a symlink, so nothing is overwritten or written through a link.
  await writeFile(positionals[1], await serializeNanopublications(result.value), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({ imported: result.value.nanopubs.length, skipped: result.skipped.count }),
  );
} catch {
  // Neither parser diagnostics nor paths/arguments may disclose private values.
  console.error("Assistant health import failed");
  process.exitCode = 1;
}
