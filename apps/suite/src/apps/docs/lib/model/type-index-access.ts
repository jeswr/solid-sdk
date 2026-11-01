// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { PrivateIndexAccessError, ResourceReadError } from "./errors.js";
import { readRdf } from "./rdf-io.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";

/** Verify rather than rewrite permissions: never remove an existing user's grants.
 * Only readable, effective owner-only WAC is supported; ACP and unknown policies
 * fail closed. UnlistedDocument is discovery metadata, never access control.
 */
export async function verifyPrivateIndexAccess(
  indexUrl: string,
  owner: string,
  podRoot: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const root = normalizePodBase(podRoot);
  const scopedFetch = createPodScopedFetch(root, { fetch: fetchImpl });
  let resource = assertWithinPodScope(root, indexUrl);
  for (;;) {
    const response = await scopedFetch(resource, { method: "HEAD" });
    if (!response.ok && response.status !== 404)
      throw new ResourceReadError(resource, response.status);
    const header = response.headers.get("link") ?? "";
    if (header.includes(ACP)) throw new PrivateIndexAccessError(indexUrl);
    // Parse Link targets and relation parameters, including multi-token rel values.
    const links = [...header.matchAll(/<([^>]+)>((?:\s*;\s*[\w-]+\s*=\s*(?:"[^"]*"|[^;,\s]+))*)/g)];
    const acl = links.find((link) =>
      [...(link[2] as string).matchAll(/;\s*([\w-]+)\s*=\s*(?:"([^"]*)"|([^;,\s]+))/g)].some(
        (parameter) =>
          (parameter[1] as string).toLowerCase() === "rel" &&
          ((parameter[2] === undefined ? parameter[3] : parameter[2]) as string)
            .split(/\s+/)
            .includes("acl"),
      ),
    );
    if (acl) {
      const aclUrl = assertWithinPodScope(root, new URL(acl[1] as string, resource).href);
      if (new URL(aclUrl).pathname.endsWith(".acr")) throw new PrivateIndexAccessError(indexUrl);
      try {
        const { dataset } = await readRdf(aclUrl, scopedFetch);
        for (const quad of dataset) {
          if (
            quad.predicate.value.startsWith(ACP) ||
            (quad.object.termType === "NamedNode" && quad.object.value.startsWith(ACP))
          )
            throw new PrivateIndexAccessError(indexUrl);
        }
        const modes = new Set<string>();
        for (const auth of new AclResource(dataset, DataFactory).authorizations) {
          const targets = SetFrom.subjectPredicate(
            auth,
            `${ACL}${resource === indexUrl ? "accessTo" : "default"}`,
            NamedNodeAs.string,
            NamedNodeFrom.string,
          );
          if (!targets.has(resource) || auth.mode.size === 0) continue;
          const groups = SetFrom.subjectPredicate(
            auth,
            `${ACL}agentGroup`,
            NamedNodeAs.string,
            NamedNodeFrom.string,
          );
          if (
            auth.agent.size !== 1 ||
            !auth.agent.has(owner) ||
            auth.agentClass.size ||
            groups.size ||
            auth.origin.size
          )
            throw new PrivateIndexAccessError(indexUrl);
          for (const mode of auth.mode) modes.add(mode);
        }
        if (!["Read", "Write", "Control"].every((mode) => modes.has(`${ACL}${mode}`)))
          throw new PrivateIndexAccessError(indexUrl);
        return;
      } catch (error) {
        if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      }
    } else if (response.ok) {
      // An existing resource without a readable control link is not evidence of privacy.
      throw new PrivateIndexAccessError(indexUrl);
    }
    if (resource === root) throw new PrivateIndexAccessError(indexUrl);
    resource = new URL(resource.endsWith("/") ? "../" : "./", resource).href;
  }
}
