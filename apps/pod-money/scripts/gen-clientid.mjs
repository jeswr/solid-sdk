// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Regenerate the static public/clientid.jsonld from the typed builder so the
// served document never drifts from the code. Run after `npm run build`:
//   node scripts/gen-clientid.mjs
//
// The served origin is a placeholder (money.solid.example); the real Next.js
// UI follow-up will template the deploy origin in.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clientIdJson } from "../dist/clientid.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/clientid.jsonld");

const json = clientIdJson({
  clientId: "https://money.solid.example/clientid.jsonld",
  clientName: "Pod Money",
  redirectUris: ["https://money.solid.example/", "https://money.solid.example/callback"],
  clientUri: "https://money.solid.example/",
  logoUri: "https://money.solid.example/logo.svg",
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, json);
process.stdout.write(`Wrote ${out}\n`);
