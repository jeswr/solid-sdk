// AUTHORED-BY Codex GPT-6
import { parseRdfSync } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { Store } from "n3";

let ontology: Store | undefined;
/** Package-owned vocabulary bytes enter RDF here, like all other RDF documents. */
export function vocabularyDataset(): Store {
  ontology ??= parseRdfSync(
    readFileSync(new URL("../../vocab/answerable.ttl", import.meta.url), "utf8"),
    { format: "text/turtle" },
  );
  return new Store([...ontology]);
}
