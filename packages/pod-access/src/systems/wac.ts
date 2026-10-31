// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { AclResource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { ACL, FOAF, modeIri, RDF, RdfNode, readModes, serialize } from "../rdf.js";
import type { EffectivePolicy, Grant, Subject } from "../types.js";

/** Read WAC rules for one resource; target reads refuse unknown semantic constructs. */
export function readWac(
  dataset: DatasetCore,
  resource: string,
  url: string,
  implementation?: "css" | "ess" | "nss",
  target = false,
): EffectivePolicy {
  const authorizations = [...new AclResource(dataset, DataFactory).authorizations];
  if (target) {
    const known = new Set([
      `${RDF}type`,
      ...[
        "accessTo",
        "default",
        "defaultForNew",
        "mode",
        "agent",
        "agentClass",
        "agentGroup",
        "origin",
      ].map((name) => ACL + name),
    ]);
    const nodes = new Set(
      authorizations.map((auth) => JSON.stringify([auth.termType, auth.value])),
    );
    for (const quad of dataset)
      if (
        !known.has(quad.predicate.value) &&
        (quad.predicate.value.startsWith(ACL) ||
          nodes.has(JSON.stringify([quad.subject.termType, quad.subject.value])))
      )
        throw new TypeError("Unplaced or unknown WAC construct");
  }
  const grants: Grant[] = [];
  for (const auth of authorizations) {
    const node = new RdfNode(auth as unknown as import("@rdfjs/types").Term, dataset, DataFactory);
    const own = node.iris(`${ACL}accessTo`).includes(resource);
    const legacy = node.iris(`${ACL}defaultForNew`).includes(resource);
    if (legacy && implementation !== "nss")
      throw new TypeError("acl:defaultForNew grants require an established NSS source dialect");
    const members = node.iris(`${ACL}default`).includes(resource) || legacy;
    if (!own && !members) continue;
    const subjects: Subject[] = node.iris(`${ACL}agent`).map((webId) => ({ kind: "agent", webId }));
    for (const value of node.iris(`${ACL}agentClass`)) {
      if (value === `${FOAF}Agent`) subjects.push({ kind: "public" });
      else if (value === `${ACL}AuthenticatedAgent`) subjects.push({ kind: "authenticated" });
      else throw new TypeError("Unsupported WAC agent class");
    }
    for (const group of node.iris(`${ACL}agentGroup`)) subjects.push({ kind: "group", group });
    // Source: a possibly enforced condition narrows the grant. Target: CSS ignores it,
    // so it must never mask actual access during planning or verification.
    const origins = target ? [] : node.iris(`${ACL}origin`);
    const who = subjects.flatMap((subject) =>
      origins.length
        ? origins.map((origin) => [subject, { kind: "origin", origin } as Subject])
        : [[subject]],
    );
    grants.push({
      modes: readModes(node.iris(`${ACL}mode`)),
      who,
      except: [],
      appliesTo: own && members ? "both" : own ? "resource" : "members",
      source: { url, node: node.value },
    });
  }
  return { grants, denials: [] };
}

/** Serialize representable WAC rules; reject denials, exclusions and unsafe conditions. */
export async function writeWac(
  policy: EffectivePolicy,
  resource: string,
  url: string,
  nodePrefix = url,
): Promise<string> {
  if (policy.denials.length) throw new TypeError("WAC cannot express denials");
  const dataset = new Store();
  let index = 0;
  for (const grant of policy.grants)
    for (const clause of grant.who) {
      if (grant.except.length) throw new TypeError("WAC cannot express exclusions");
      const auth = new RdfNode(`${nodePrefix}#authorization-${index++}`, dataset, DataFactory);
      auth.add(`${RDF}type`, `${ACL}Authorization`);
      if (grant.appliesTo !== "members") auth.add(`${ACL}accessTo`, resource);
      if (grant.appliesTo !== "resource") auth.add(`${ACL}default`, resource);
      for (const mode of grant.modes) auth.add(`${ACL}mode`, modeIri(mode));
      const principals = clause.filter((subject) => subject.kind !== "origin");
      if (principals.length !== 1) throw new TypeError("WAC needs one principal per clause");
      if (clause.filter((subject) => subject.kind === "origin").length > 1)
        throw new TypeError("WAC cannot express intersecting origins");
      for (const subject of clause) {
        switch (subject.kind) {
          case "agent":
            auth.add(`${ACL}agent`, subject.webId);
            break;
          case "public":
            auth.add(`${ACL}agentClass`, `${FOAF}Agent`);
            break;
          case "authenticated":
            auth.add(`${ACL}agentClass`, `${ACL}AuthenticatedAgent`);
            break;
          case "group":
            auth.add(`${ACL}agentGroup`, subject.group);
            break;
          case "origin":
            throw new TypeError("WAC targets do not establish enforcement of origin restrictions");
          default:
            throw new TypeError("Unsupported WAC subject");
        }
      }
    }
  return serialize(dataset);
}
