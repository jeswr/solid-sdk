// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { access, readFile, stat } from "node:fs/promises";
import { assertCspHashes } from "./csp-hashes.mjs";
import { filesUnder } from "./route-manifest.mjs";

export async function checkNative(exportDir, limit = 40_000_000) {
  for (const name of ["api", "api.html"]) {
    if (
      await access(`${exportDir}/${name}`).then(
        () => true,
        () => false,
      )
    )
      throw new Error("Server API routes must not enter the native export");
  }
  let bytes = 0;
  for (const path of await filesUnder(exportDir)) {
    bytes += (await stat(path)).size;
    const body = await readFile(path);
    if (/DEMO_|dev\/components/.test(body.toString("utf8")))
      throw new Error(`Fixture marker in native export: ${path}`);
    if (path.endsWith(".html")) assertCspHashes(body.toString("utf8"));
  }
  console.log(`Native bundle: ${bytes} bytes (${(bytes / 1_000_000).toFixed(2)} MB / 40 MB)`);
  if (bytes > limit) throw new Error("Native bundle exceeds 40 MB");
  return bytes;
}

if (process.argv[1] === new URL(import.meta.url).pathname) await checkNative(process.argv[2]);
