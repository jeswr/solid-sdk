// AUTHORED-BY Codex GPT-6.1-Sol
import * as verifier from "@jeswr/agent-audit/verify";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { findPackageJSON, isBuiltin } from "module";
import { Store } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath, pathToFileURL } from "url";
import { expect, it, vi } from "vitest";
import { node } from "../src/rdf.js";

it("keeps the compiled verifier and its transitive dependencies free of Node builtins", () => {
  const visited = new Set<string>();
  function walk(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const imports = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g,
    );
    for (const match of imports) {
      const specifier = match[1] as string;
      expect(isBuiltin(specifier), `${file} imports ${specifier}`).toBe(false);
      if (specifier.startsWith(".")) {
        walk(fileURLToPath(new URL(specifier, pathToFileURL(file))));
      } else {
        const manifestPath = findPackageJSON(specifier, pathToFileURL(file)) as string;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const parts = specifier.split("/");
        const subpath = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/");
        let target = manifest.exports[subpath ? `./${subpath}` : "."];
        while (target && typeof target !== "string")
          target = target.node ?? target.import ?? target.default;
        expect(typeof target, `${specifier} must have a resolvable ESM export`).toBe("string");
        walk(fileURLToPath(new URL(target, pathToFileURL(manifestPath))));
      }
    }
  }
  walk(fileURLToPath(new URL("../dist/verify.js", import.meta.url)));
  expect(visited).toContain(fileURLToPath(new URL("../dist/prov.js", import.meta.url)));
  expect(visited.size).toBeGreaterThan(3);
});

it("seals and verifies through the public export with Node globals unavailable", () => {
  let result: boolean[];
  try {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("Buffer", undefined);
    const entry = verifier.seal(1, "2026-10-26T12:00:00.000Z", verifier.GENESIS, {
      type: "ingest",
      id: "urn:event:1",
      agent: "urn:agent:1",
      owner: "urn:owner:1",
    });
    const parsed = verifier.parseAuditEntry(entry);
    const head = verifier.parseAuditHead("1", parsed.hash);
    result = [verifier.verifyLedger([parsed]).ok, verifier.verifyLatestRange([parsed], head).ok];
  } finally {
    vi.unstubAllGlobals();
  }
  expect(result).toEqual([true, true]);
});

it("writes the shared PROV projection through the public export without Node globals", () => {
  const store = new Store();
  const url = "https://pod.example/agent/audit/1.ttl";
  const headUrl = "https://pod.example/agent/audit/chain.ttl";
  const entry = verifier.seal(1, "2026-10-26T12:00:00.000Z", verifier.GENESIS, {
    type: "decision",
    id: "urn:event:1",
    agent: "urn:agent:1",
    owner: "urn:owner:1",
    decision: "permit",
  });
  try {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("Buffer", undefined);
    verifier.writeEntryGraph(node(store, url), node(store, `${url}#entry`), entry);
    verifier.writeHeadGraph(node(store, headUrl), entry.seq, entry.hash);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(node(store, url).text("https://jeswr.org/ns/agent#ledgerHash")).toBe(entry.hash);
  expect(node(store, url).text("https://jeswr.org/ns/agent#decision")).toBe("permit");
  expect(node(store, headUrl).values("http://www.w3.org/ns/prov#hadMember")[0]?.value).toBe(
    `${url}#entry`,
  );
});
