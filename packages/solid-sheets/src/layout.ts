// AUTHORED-BY Codex (GPT-6.1 Sol)
import { safeHttpIri } from "@jeswr/rdf-serialize";
export function httpIri(value: string): string {
  const iri = safeHttpIri(value);
  if (!iri || new URL(iri).username || new URL(iri).password)
    throw new TypeError("Invalid resource IRI");
  return iri;
}

export function workbookLayout(container: string) {
  const root = new URL(httpIri(container));
  if (!root.pathname.endsWith("/") || root.search || root.hash) {
    throw new TypeError("Workbook must be a container URL without query or fragment");
  }
  const index = new URL("index.ttl", root).href;
  return {
    container: root.href,
    index,
    subject: `${index}#it`,
    snapshot: new URL("workbook.json", root).href,
    sheet(number: number) {
      if (!Number.isSafeInteger(number) || number < 1) throw new TypeError("Invalid sheet number");
      return {
        csv: new URL(`sheets/${number}.csv`, root).href,
        descriptor: new URL(`sheets/${number}.jsonld`, root).href,
      };
    },
  };
}
