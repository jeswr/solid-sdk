// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { assertNotWider, ownerPolicy, policiesEqual, scopePolicy } from "./policy.js";
import {
  ACL,
  ACP,
  aclLink,
  links,
  parse,
  RDF,
  requireOk,
  requireRepresentation,
  serialize,
} from "./rdf.js";
import { type AcpDialect, readAcp, writeAcp } from "./systems/acp.js";
import { readWac, writeWac } from "./systems/wac.js";
import { assertSpecificAccess } from "./target-access.js";
import type { AccessDocument, AccessSystem, EffectivePolicy, PodSide } from "./types.js";
export async function detectAccessSystem(
  side: PodSide,
  signal?: AbortSignal,
): Promise<AccessSystem> {
  const head = requireOk(await side.http.head(side.root, { signal }));
  const url = aclLink(head, side.root, side.root);
  if (!url) return "unknown";
  const response = await side.http.get(url, { accept: "text/turtle", signal });
  const advertised =
    links(head, side.root, "type").includes(`${ACP}AccessControlResource`) ||
    links(response, url, "type").includes(`${ACP}AccessControlResource`);
  if (!response.ok) return advertised ? "acp" : "unknown";
  try {
    const dataset = await parse(response, url);
    const acp = [...dataset].some(
      (q) =>
        q.predicate.value.startsWith(ACP) ||
        (q.object.termType === "NamedNode" && q.object.value.startsWith(ACP)),
    );
    const wac =
      dataset.match(
        null,
        DataFactory.namedNode(`${RDF}type`),
        DataFactory.namedNode(`${ACL}Authorization`),
      ).size > 0;
    return (acp || advertised) && wac
      ? "unknown"
      : acp || advertised
        ? "acp"
        : wac
          ? "wac"
          : "unknown";
  } catch {
    return "unknown";
  }
}
export async function readAccess(
  side: PodSide,
  resource: string,
  system: AccessSystem,
  signal?: AbortSignal,
  advertised?: string,
  requireSpecific = false,
): Promise<AccessDocument | undefined> {
  const url =
    advertised ?? aclLink(await side.http.head(resource, { signal }), resource, side.root);
  if (!url) return undefined;
  const response = await side.http.get(url, { accept: "text/turtle", signal });
  if (response.status === 404) return undefined;
  requireOk(response);
  const turtle = await requireRepresentation(response).text();
  const dataset = await parse(new Response(turtle, { headers: response.headers }), url);
  if (system === "unknown") throw new TypeError("Cannot read unknown access system");
  const document: AccessDocument = {
    policy:
      system === "wac"
        ? readWac(dataset, resource, url, side.implementation, requireSpecific)
        : readAcp(
            dataset,
            resource,
            url,
            side.implementation === "ess" ? "ess" : "css",
            requireSpecific,
          ),
    url,
    // All later scope checks and merges consume Turtle, even if the server
    // returned JSON-LD despite our Accept preference.
    turtle: await serialize(dataset),
    etag: response.headers.get("etag"),
  };
  if (requireSpecific) await assertSpecificAccess(resource, url, new Map(), document);
  return document;
}
export async function writeAccess(
  side: PodSide,
  resource: string,
  url: string,
  policy: EffectivePolicy,
  system: AccessSystem,
  dialect: AcpDialect,
  conditional: { ifMatch?: string; ifNoneMatch?: "*" } = {},
  mergeDocument?: AccessDocument,
): Promise<Response> {
  assertNotWider(scopePolicy(policy, "resource"), ownerPolicy(side.ownerWebId));
  if (resource.endsWith("/"))
    assertNotWider(scopePolicy(policy, "members"), ownerPolicy(side.ownerWebId));
  if (system === "unknown") throw new TypeError("Cannot lock an unknown access system");
  const prefix = mergeDocument ? `${url}?migration=${crypto.randomUUID()}` : url;
  let turtle =
    system === "wac"
      ? await writeWac(policy, resource, url, prefix)
      : await writeAcp(policy, resource, url, dialect, prefix);
  const dataset = await parse(
    new Response(turtle, { headers: { "content-type": "text/turtle" } }),
    url,
  );
  if (mergeDocument) {
    const original = await parse(
      new Response(mergeDocument.turtle, { headers: { "content-type": "text/turtle" } }),
      url,
    );
    for (const quad of original) dataset.add(quad);
    turtle = await serialize(dataset);
  }
  const emitted =
    system === "wac"
      ? readWac(dataset, resource, url, side.implementation, true)
      : readAcp(dataset, resource, url, dialect, true);
  for (const scope of ["resource", "members"] as const)
    if (!policiesEqual(scopePolicy(policy, scope), scopePolicy(emitted, scope)))
      throw new TypeError("Serialized access policy differs from the plan");
  return requireOk(
    await side.http.put(url, turtle, { contentType: "text/turtle", ...conditional }),
  );
}
