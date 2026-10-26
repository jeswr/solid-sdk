// AUTHORED-BY Codex GPT-6.1-Sol

import { serialize } from "@jeswr/rdf-serialize";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { writeFile } from "fs/promises";
import { DataFactory, Store } from "n3";
import { RdfResource } from "../dist/rdf/resource.js";
import { AGENT, RDFS, TERM_DEFINITIONS } from "../dist/vocab.js";

const store = new Store();
for (const [name, definition] of Object.entries(TERM_DEFINITIONS)) {
  const term = new RdfResource(`${AGENT}${name}`, store, DataFactory);
  term.write(`${RDFS}comment`, "string", definition);
  term.write(`${RDFS}label`, "string", name);
}
await writeFile(
  new URL("../docs/vocab.ttl", import.meta.url),
  `# AUTHORED-BY Codex GPT-6.1-Sol\n${await serialize([...store], { prefixes: { agent: AGENT, rdfs: RDFS } })}`,
);
