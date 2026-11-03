// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { filesUnder } from "./route-manifest.mjs";

export async function checkWeb(directory) {
  const chunks = (await filesUnder(directory)).filter((path) => path.endsWith(".js"));
  if (!chunks.length) throw new Error("Missing web build chunks");
  for (const path of chunks) {
    if (/NativeCalendar(?:View|Index)/.test(await readFile(path, "utf8")))
      throw new Error(`Native calendar leaked into web chunk: ${path}`);
  }
  console.log(`Web calendar isolation: ${chunks.length} chunks checked`);
}

if (process.argv[1] === new URL(import.meta.url).pathname)
  await checkWeb(process.argv[2] ?? ".next/static");
