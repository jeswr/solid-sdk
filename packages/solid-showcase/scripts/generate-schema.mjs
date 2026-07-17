// AUTHORED-BY Claude Fable 5
// Regenerate the shipped JSON-Schema artifact from the zod schema. Run AFTER a build
// (the script imports the built output): `pnpm run build && pnpm run generate:schema`.
// A unit test (test/schema-sync.test.ts) asserts the committed artifact matches.
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkthroughJsonSchema } from "../dist/schema.js";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../schema/walkthrough.v1.json");
await writeFile(target, `${JSON.stringify(walkthroughJsonSchema(), null, 2)}\n`);
console.log(`wrote ${target}`);
