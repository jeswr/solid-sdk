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
    const allowance = [
      {
        file: "src/runtime/agent.ts",
        function: "pending",
        rule: "json-signature",
        count: 1,
        reason: "Legacy message body still lacks its complete pinned context.",
      },
      {
        file: "src/runtime/agent.ts",
        function: "pending",
        rule: "foreign-json-parse",
        count: 1,
        reason: "Legacy byte admission remains in this runtime function.",
      },
    ];
    put("scripts/rdf-pipeline-allowlist.json", JSON.stringify(allowance));
    expect(run(allowance).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "invalid-allowance",
          detail: "nonempty allowances require the recorded RDF-PIPELINE-STATUS.json ceiling",
        }),
      ]),
    );
    put("RDF-PIPELINE-STATUS.json", JSON.stringify({ findings: run().findings }));
    expect(run(allowance)).toMatchObject({ failures: [], exempted: 2 });
    put(
      "src/runtime/agent.ts",
      'export function pending(value: import("../core/types.js").JsonObject) { JSON.parse("{}"); return JSON.parse("{}"); }',
    );
    expect(run(allowance).failures).toEqual([
      expect.objectContaining({ rule: "foreign-json-parse" }),
    ]);
    put("src/runtime/agent.ts", "export function pending() { return true; }");
    expect(run(allowance).failures).toEqual([
      expect.objectContaining({ rule: "stale-allowance" }),
      expect.objectContaining({ rule: "stale-allowance" }),
    ]);
    expect(run([{ ...allowance[0], reason: "" }]).failures).toEqual([
      expect.objectContaining({ rule: "invalid-allowance" }),
    ]);
    expect(run([{ ...allowance[0], count: 0 }]).failures).toEqual([
      expect.objectContaining({ rule: "invalid-allowance" }),
    ]);
    expect(run([allowance[0], allowance[0]]).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "invalid-allowance",
          detail: "duplicate allowance for this file/function/rule",
        }),
      ]),
    );
    put("src/gates/local.test.ts", "JSON.parse('{}');");
    expect(run().failures).toEqual([]);

    // A needed entry still cannot add a new scope or increase a recorded count.
    put(
      "src/runtime/agent.ts",
      'export function pending(value: import("../core/types.js").JsonObject) { return value; }',
    );
    put(
      "RDF-PIPELINE-STATUS.json",
      JSON.stringify({
        findings: [{ file: "src/runtime/agent.ts", function: "pending", rule: "json-signature" }],
      }),
    );
    expect(run([allowance[0]])).toMatchObject({ failures: [], exempted: 1 });
    put(
      "src/runtime/agent.ts",
      'export function pending(value: import("../core/types.js").JsonObject, extra: import("../core/types.js").JsonObject) { return value; }',
    );
    expect(run([{ ...allowance[0], count: 2 }]).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "invalid-allowance",
          detail: "allowance would grow beyond the recorded file/function/rule ceiling",
        }),
      ]),
    );
    put(
      "src/runtime/agent.ts",
      'export function another(value: import("../core/types.js").JsonObject) { return value; }',
    );
    expect(run([{ ...allowance[0], function: "another" }]).failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "invalid-allowance",
          detail: "allowance would grow beyond the recorded file/function/rule ceiling",
        }),
      ]),
    );
    put("src/gates/check.ts", "export function triples() { return DataFactory.quad(); }");
    put(
      "RDF-PIPELINE-STATUS.json",
      JSON.stringify({
        findings: [{ file: "src/gates/check.ts", function: "triples", rule: "direct-quad" }],
      }),
    );
    expect(
      run([
        {
          file: "src/gates/check.ts",
          function: "triples",
          rule: "direct-quad",
          count: 1,
          reason: "This must never exempt direct triple construction.",
        },
      ]).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "invalid-allowance" }),
        expect.objectContaining({ rule: "direct-quad" }),
      ]),
    );
    put("src/core/types.ts", "export interface Message { body: unknown; }");
    put(
      "RDF-PIPELINE-STATUS.json",
      JSON.stringify({
        findings: [{ file: "src/core/types.ts", function: "Message", rule: "object-model" }],
      }),
    );
    expect(
      run([
        {
          file: "src/core/types.ts",
          function: "Message",
          rule: "object-model",
          count: 1,
          reason: "Core models must remain hard failures until converted to wrappers.",
        },
      ]).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "invalid-allowance" }),
        expect.objectContaining({ rule: "object-model" }),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
