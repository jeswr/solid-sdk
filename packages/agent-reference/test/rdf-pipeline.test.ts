// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
// @ts-expect-error The executable JavaScript guard intentionally has no declaration file.
import { checkRdfPipeline } from "../scripts/check-rdf-pipeline.mjs";

it("enforces RDF signatures and parsing boundaries through the TypeScript compiler API", async () => {
  const root = mkdtempSync(join(tmpdir(), "rdf-pipeline-"));
  const run = (allowlist = {}) => checkRdfPipeline(root, allowlist);
  const put = (path: string, source: string) => {
    const target = join(root, path);
    mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    writeFileSync(target, source);
  };
  try {
    put(
      "src/core/types.ts",
      "export type JsonObject = Record<string, unknown>; export interface Message { body: JsonObject }",
    );
    put(
      "src/gates/check.ts",
      'import type { JsonObject as Alias } from "../core/types.js"; export function bad(value: Alias) { return JSON.parse(value.body as string); }',
    );
    put("scripts/rdf-pipeline-allowlist.json", "{}");
    expect(run().failures.map((failure: { rule: string }) => failure.rule)).toEqual(
      expect.arrayContaining(["object-model", "json-signature", "foreign-json-parse"]),
    );
    put("src/core/types.ts", "export type JsonObject = Record<string, unknown>;");
    put(
      "src/gates/check.ts",
      "export function check(node: { readonly dataset: unknown }) { return Boolean(node.dataset); }",
    );
    put("src/wire/read.ts", "export function read(bytes: string) { return JSON.parse(bytes); }");
    expect(run().failures).toEqual([]);
    put(
      "src/runtime/agent.ts",
      'export function pending(value: import("../core/types.js").JsonObject) { return JSON.parse("{}"); }',
    );
    put(
      "scripts/rdf-pipeline-allowlist.json",
      JSON.stringify({ pending: { "json-signature": 1, "foreign-json-parse": 1 } }),
    );
    const allowance = { pending: { "json-signature": 1, "foreign-json-parse": 1 } };
    expect(run(allowance)).toMatchObject({ failures: [], exempted: 2 });
    put(
      "src/runtime/agent.ts",
      'export function pending(value: import("../core/types.js").JsonObject) { JSON.parse("{}"); return JSON.parse("{}"); }',
    );
    expect(run(allowance).failures).toEqual([
      expect.objectContaining({ rule: "foreign-json-parse" }),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
