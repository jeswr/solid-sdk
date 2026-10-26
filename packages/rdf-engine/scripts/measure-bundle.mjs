// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/** Measure the installed browser artifact; never substitute a locally built WASM. */
export async function measureBundle() {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.resolve("@sparq-org/sparq")), "utf8"),
  );
  const bytes = await readFile(
    new URL(import.meta.resolve("@sparq-org/sparq/wasm/sparq_wasm_bg.wasm")),
  );
  return {
    // biome-ignore lint/style/useNamingConvention: JSON Schema metadata key.
    $comment: "AUTHORED-BY Codex GPT-6.1-Sol",
    package: "@sparq-org/sparq",
    version: manifest.version,
    artifact: "wasm/sparq_wasm_bg.wasm",
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    gzipLevel: 9,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    budget: { rawBytes: 4_194_304, gzipBytes: 1_572_864 },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeFile(
    new URL("../bench/bundle.json", import.meta.url),
    `${JSON.stringify(await measureBundle(), null, 2)}\n`,
  );
}
