// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { ownerPolicy, policiesEqual, scopePolicy } from "../policy.js";
import { ACL, ACP, RDF, safeIri } from "../rdf.js";
import { writeAcp } from "../systems/acp.js";
import { writeWac } from "../systems/wac.js";
import { roleError } from "./errors.js";
import { detectModel, links, load, request, requireOk, type Snapshot, scoped } from "./http.js";
import { properties } from "./rdf.js";
import type { RolesOptions } from "./types.js";

/** Install private access. Replacing foreign grants requires explicit consent. */
export interface OwnerOnlyOptions extends Pick<RolesOptions, "fetch" | "root" | "implementation"> {
  /** Include members; defaults true for trailing-slash containers. Explicit false removes defaults. */
  inherit?: boolean;
  /** Remove existing own-document foreign grants. Ancestor grants still refuse. Default false. */
  replace?: boolean;
}

function httpUrl(input: string): string {
  safeIri(input);
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw roleError("scope", input, "A credential-free absolute http(s) URL is required");
  return url.href;
}

/**
 * Discover and conditionally install owner-only WAC/ACP access, using the trusted
 * deployment dialect (CSS by default). Never guess an access document's URL or retry.
 */
export async function makeOwnerOnly(
  resourceUrl: string,
  ownerWebId: string,
  options: OwnerOnlyOptions,
): Promise<void> {
  // Snapshot mutable caller options before the first await.
  const {
    fetch,
    root,
    implementation = "css",
    inherit: requestedInheritance,
    replace = false,
  } = options;
  if (!["css", "ess", "nss"].includes(implementation))
    throw roleError("unsupported", resourceUrl, "Unknown access-control implementation");
  const resource = httpUrl(resourceUrl);
  const inherit = requestedInheritance ?? resource.endsWith("/");
  const owner = httpUrl(ownerWebId);
  if (owner.startsWith(ACP))
    throw roleError("unsupported", owner, "Reserved ACP agents are not owner WebIDs");
  const io = { fetch, root: root ?? `${new URL(resource).origin}/`, implementation };
  scoped(resource, io.root);
  if (inherit && !resource.endsWith("/"))
    throw roleError("scope", resource, "Member inheritance requires a container");
  const head = await request(resource, io, { method: "HEAD" });
  requireOk(head, resource);
  const acpLinks = links(head.headers, resource, `${ACP}accessControl`);
  const endpoints = [...new Set([...links(head.headers, resource, "acl"), ...acpLinks])];
  if (endpoints.length !== 1)
    throw roleError("unsupported", resource, "Exactly one advertised access document is required");
  const endpoint = endpoints[0] as string;
  const accessQuery = implementation === "ess" ? "?ext=acr" : false;
  scoped(endpoint, io.root, accessQuery);
  // ESS addresses a resource's ACR as the resource itself plus `?ext=acr`; any other
  // query-addressed endpoint could point at a different resource's document.
  if (accessQuery && endpoint.includes("?") && endpoint !== `${resource}${accessQuery}`)
    throw roleError("scope", endpoint, "An ESS access document must belong to the resource");
  if (endpoint === resource)
    throw roleError("scope", endpoint, "An access document cannot replace the protected resource");
  // An ACP relation/type is explicit evidence even on create. An acl relation alone
  // is shared by WAC and ESS: require a deciding own or ancestor RDF document.
  const model =
    acpLinks.length || links(head.headers, resource, "type").includes(`${ACP}AccessControlResource`)
      ? "acp"
      : (await detectModel(resource, io, accessQuery)).model;
  if (model === "unknown" || (model === "acp" && implementation === "nss"))
    throw roleError("unsupported", resource, "Unsupported or unknown access-control model");
  const snapshot = await load(resource, { ...io, model }, model, accessQuery);
  if (snapshot.ownUrl !== endpoint)
    throw roleError("conflict", resource, "Access discovery changed");
  // ACP inheritance is additive. Replacing the child's ACR cannot remove it.
  if (model === "acp")
    for (const document of snapshot.documents)
      if (document !== snapshot.own)
        for (const grant of scopePolicy(document.policy, "members").grants)
          if (
            grant.modes.size &&
            grant.who.some(
              (clause) =>
                !clause.some((subject) => subject.kind === "agent" && subject.webId === owner),
            )
          )
            throw roleError("inherited-grant", resource, "Ancestor access is not owner-only");
  const existing = snapshot.own;
  // Any subject naming a non-owner agent, class, group or client, typed as an
  // authorization or not. The no-op shortcut below must never keep such a node.
  let sawForeign = false;
  if (existing) {
    // Inspect every placement, including foreign targets and detached selectors;
    // projections for just the selected resource must never hide foreign grants.
    for (const subject of new Map(
      [...existing.dataset].map((q) => [
        JSON.stringify([q.subject.termType, q.subject.value]),
        q.subject,
      ]),
    ).values()) {
      const node = properties(subject, existing.dataset);
      const namespace = model === "wac" ? ACL : ACP;
      const foreign =
        node.iris(`${namespace}agent`).some((agent) => agent !== owner) ||
        ["agentClass", "agentGroup", "client"].some(
          (name) => node.terms(namespace + name).size > 0,
        );
      sawForeign ||= foreign;
      if (foreign && replace !== true)
        throw roleError("unsupported", resource, "Existing foreign grants require replace: true");
      for (const name of model === "wac" ? ["accessTo", "default", "defaultForNew"] : ["resource"])
        if (node.iris(namespace + name).some((target) => target !== resource))
          throw roleError("scope", resource, "Access document also protects another resource");
    }
    if (
      !inherit &&
      requestedInheritance !== false &&
      scopePolicy(existing.policy, "members").grants.some((grant) =>
        grant.who.some((clause) =>
          clause.some((subject) => subject.kind === "agent" && subject.webId === owner),
        ),
      )
    )
      throw roleError(
        "unsupported",
        resource,
        "Removing owner member access requires inherit: false",
      );
  }
  const policy = ownerPolicy(owner, inherit);
  // Semantic equality includes both scopes and management, and treats Write as
  // including Append. A verified no-op needs neither a validator nor a PUT.
  if (
    existing &&
    !sawForeign &&
    (["resource", "members"] as const).every((scope) =>
      policiesEqual(scopePolicy(existing.policy, scope), scopePolicy(policy, scope)),
    )
  )
    return;
  const etag = existing?.etag;
  if (existing && (etag == null || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)))
    throw roleError("precondition-required", endpoint, "Replacement requires a strong ETag");
  const body =
    model === "wac"
      ? await writeWac(policy, resource, endpoint)
      : await writeAcp(policy, resource, endpoint, implementation === "ess" ? "ess" : "css");
  // Retain annotations while replacing access semantics through the existing writers.
  const dataset = await parseRdf(body, "text/turtle", { baseIRI: endpoint });
  if (existing)
    for (const quad of existing.dataset)
      if (
        !quad.predicate.value.startsWith(ACL) &&
        !quad.predicate.value.startsWith(ACP) &&
        !(
          quad.predicate.value === `${RDF}type` &&
          quad.object.termType === "NamedNode" &&
          (quad.object.value.startsWith(ACL) || quad.object.value.startsWith(ACP))
        )
      )
        dataset.add(quad);
  // Match the role layer's last-moment discovery/governing-validator check. Own
  // document races after this read are still protected by the original HTTP CAS.
  const version = (state: Snapshot) =>
    JSON.stringify([
      state.ownUrl,
      state.own ? state.own.etag : false,
      state.documents.map((document) => [document.resource, document.url, document.etag]),
    ]);
  if (version(await load(resource, { ...io, model }, model, accessQuery)) !== version(snapshot))
    throw roleError("conflict", resource, "Access validators or discovery changed");
  const response = await request(endpoint, io, {
    method: "PUT",
    headers: {
      "content-type": "text/turtle",
      ...(existing ? { "if-match": etag as string } : { "if-none-match": "*" }),
    },
    body: await serialize([...dataset]),
  });
  requireOk(response, endpoint);
}
