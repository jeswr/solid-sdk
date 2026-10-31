// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { parseLinkHeaders } from "@jeswr/storage-capabilities";

export {
  ACL,
  ACP,
  FOAF,
  modeIri,
  modes,
  parent,
  RDF,
  RdfNode,
  readModes,
  safeIri,
  serialize,
} from "@jeswr/pod-access";
export async function parse(
  response: Response,
  url: string,
): Promise<Awaited<ReturnType<typeof parseRdf>>> {
  requireRepresentation(response);
  return parseRdf(await response.text(), response.headers.get("content-type"), { baseIRI: url });
}
export function requireRepresentation(response: Response): Response {
  if (response.status !== 200)
    throw new Error(`Expected a complete representation (${response.status})`);
  return response;
}
export function links(response: Response, url: string, rel: string): string[] {
  return parseLinkHeaders(response.headers.get("link"), url)
    .filter((link) => link.context === url && link.rel.includes(rel))
    .map((link) => link.target);
}
export function aclLink(response: Response, url: string, root: string): string | undefined {
  const found = links(response, url, "acl");
  if (found.length > 1) throw new TypeError("Ambiguous ACL links");
  return found[0] === undefined ? undefined : assertWithinPodScope(root, found[0]);
}
export function requireOk(response: Response): Response {
  if (!response.ok) throw new Error(`Pod request failed (${response.status})`);
  return response;
}
