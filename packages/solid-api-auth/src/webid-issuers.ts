// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";

/** Shared profile parser; the resource verifier requires the exact claimed WebID subject. */
export async function readWebIdIssuers(
  webId: string,
  transport: typeof fetch,
  allowDocumentSubject = false,
): Promise<string[]> {
  const document = new URL(webId);
  document.hash = "";
  const { dataset } = await fetchRdf(document.href, { fetch: transport, maxBytes: 262_144 });
  return [...dataset.match()]
    .filter(
      (quad) =>
        quad.subject.termType === "NamedNode" &&
        (quad.subject.value === webId ||
          (allowDocumentSubject && quad.subject.value === document.href)) &&
        quad.predicate.value === "http://www.w3.org/ns/solid/terms#oidcIssuer" &&
        quad.object.termType === "NamedNode",
    )
    .map((quad) => quad.object.value);
}
