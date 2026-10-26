// AUTHORED-BY Codex GPT-6.1-Sol
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { wasmUrl } from "./browser.js";

test("the installed browser WASM meets the amended size budget and committed measurement", async () => {
  const record = JSON.parse(
    await readFile(new URL("../bench/bundle.json", import.meta.url), "utf8"),
  );
  const installed = JSON.parse(
    await readFile(new URL("../package.json", import.meta.resolve("@sparq-org/sparq")), "utf8"),
  );
  expect(installed.version).toBe("0.1.5");
  const bytes = await readFile(
    new URL(import.meta.resolve("@sparq-org/sparq/wasm/sparq_wasm_bg.wasm")),
  );
  const rawBytes = bytes.byteLength;
  const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
  expect(rawBytes).toBeLessThanOrEqual(4_194_304);
  expect(gzipBytes).toBeLessThanOrEqual(1_572_864);
  expect(record).toMatchObject({
    version: "0.1.5",
    rawBytes,
    gzipBytes,
    gzipLevel: 9,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    budget: { rawBytes: 4_194_304, gzipBytes: 1_572_864 },
  });
});

test("copies the installed artifact to a content-hashed public asset and resolves its URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rdf-engine-assets-"));
  try {
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/copy-wasm.mjs", import.meta.url)), directory],
      { encoding: "utf8" },
    ).trim();
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    expect(output).toBe(manifest.fileName);
    const copy = await readFile(join(directory, manifest.fileName));
    expect(createHash("sha256").update(copy).digest("hex")).toBe(manifest.sha256);
    expect(wasmUrl(output, "https://app.example/wasm/").href).toBe(
      `https://app.example/wasm/${output}`,
    );
    expect(wasmUrl(output).href).toContain(`/wasm/${output}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
