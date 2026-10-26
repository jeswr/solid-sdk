// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Copy the installed prebuilt browser WASM with an immutable, content-hashed filename. */
export async function copyWasm(directory) {
  const source = new URL(import.meta.resolve("@sparq-org/sparq/wasm/sparq_wasm_bg.wasm"));
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const fileName = `sparq-${hash.slice(0, 16)}.wasm`;
  await mkdir(directory, { recursive: true });
  await copyFile(source, resolve(directory, fileName));
  await writeFile(
    resolve(directory, "manifest.json"),
    `${JSON.stringify({ fileName, sha256: hash }, null, 2)}\n`,
  );
  return fileName;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2] ?? "public/wasm";
  console.log(await copyWasm(resolve(directory)));
}
