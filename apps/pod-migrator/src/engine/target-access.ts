// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, isWithinPodScope } from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { ACL, ACP, aclLink, parent, parse, requireOk } from "./rdf.js";
import type { AccessDocument, PodSide } from "./types.js";

/** Include existing siblings and the profile, even when review skips their content. */
export async function targetAccessLinks(
  side: PodSide,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const seen = new Set<string>();
  const profile = side.ownerWebId.split("#")[0] as string;
  const queue = [side.root];
  if (isWithinPodScope(side.root, profile)) queue.push(profile);
  while (queue.length) {
    signal?.throwIfAborted();
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    if (seen.size > 10000) throw new TypeError("Target inventory exceeds 10000 resources");
    const head = await side.http.head(url, { signal });
    if (head.status !== 404) requireOk(head);
    const acl = aclLink(head, url, side.root);
    if (acl) found.set(url, acl);
    if (!head.ok || !url.endsWith("/")) continue;
    const dataset = await parse(
      requireOk(await side.http.get(url, { accept: "text/turtle", signal })),
      url,
    );
    for (const member of new Container(url, dataset, DataFactory).contains) {
      const child = assertWithinPodScope(side.root, member.id);
      if (parent(child, side.root) !== url)
        throw new TypeError("Target lists a non-child resource");
      queue.push(child);
    }
  }
  return found;
}

/** A Link advertisement alone is insufficient evidence of an exclusive access document. */
export async function assertSpecificAccess(
  resource: string,
  acl: string,
  inventory: ReadonlyMap<string, string>,
  document?: AccessDocument,
): Promise<void> {
  for (const [other, otherAcl] of inventory)
    if ((other !== resource && otherAcl === acl) || other === acl)
      throw new TypeError("Target access document is shared with another resource");
  if (!document) return;
  const dataset = await parse(
    new Response(document.turtle, { headers: { "content-type": "text/turtle" } }),
    acl,
  );
  for (const predicate of [
    `${ACL}accessTo`,
    `${ACL}default`,
    `${ACL}defaultForNew`,
    `${ACP}resource`,
  ])
    for (const quad of dataset.match(null, DataFactory.namedNode(predicate)))
      if (quad.object.value !== resource && quad.object.value !== acl)
        throw new TypeError("Target access document is not specific to this resource");
}
