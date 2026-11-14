// AUTHORED-BY Codex GPT-6
/** Solid document views. WAC has no temporal constraint; expiry requires ACL withdrawal. */
import { parseRdf } from "@jeswr/fetch-rdf";
import { buildListingDataset } from "@jeswr/ldp-container";
import { serialize } from "@jeswr/rdf-serialize";
import { addIriTriple, objectTerms } from "@jeswr/rdf-serialize/wrapper";
import { TermWrapper } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";

const ACL = "http://www.w3.org/ns/auth/acl#";
const LDP = "http://www.w3.org/ns/ldp#";
const PROV = "http://www.w3.org/ns/prov#";
export type AccessMode = "Read" | "Write" | "Append" | "Control";
export interface AccessRule {
  agent?: string;
  public?: boolean;
  authenticated?: boolean;
  modes: readonly AccessMode[];
  resource: string;
  defaults?: boolean;
  policy?: string;
}
export async function accessDocument(url: string, rules: readonly AccessRule[]): Promise<string> {
  const dataset = new Store();
  const acl = new AclResource(dataset, DataFactory);
  for (const [i, value] of rules.entries()) {
    const rule = new Authorization(`${url}#rule-${i}`, acl, DataFactory);
    rule.type.add(`${ACL}Authorization`);
    rule.accessTo = value.resource;
    if (value.defaults) rule.default = value.resource;
    if (value.agent) rule.agent.add(value.agent);
    if (value.public) rule.accessibleToAny = true;
    if (value.authenticated) rule.accessibleToAuthenticated = true;
    for (const mode of value.modes) rule.mode.add(`${ACL}${mode}`);
    if (value.policy) addIriTriple(rule, `${PROV}wasDerivedFrom`, value.policy);
  }
  return serialize([...dataset]);
}
const iris = (node: TermWrapper, predicate: string) =>
  [...objectTerms(node, predicate)].filter((t) => t.termType === "NamedNode").map((t) => t.value);
export async function accessModes(
  body: string,
  aclUrl: string,
  resource: string,
  agent: string | undefined,
  inherited: boolean,
): Promise<Set<AccessMode>> {
  const dataset = await parseRdf(body, "text/turtle", {
    baseIRI: aclUrl,
    maxBytes: 65536,
    maxQuads: 1024,
  });
  const acl = new AclResource(dataset, DataFactory);
  const modes = new Set<AccessMode>();
  for (const rule of acl.authorizations) {
    const applies = inherited
      ? [...iris(rule, `${ACL}default`), ...iris(rule, `${ACL}defaultForNew`)].includes(resource)
      : iris(rule, `${ACL}accessTo`).includes(resource);
    if (!applies || iris(rule, `${ACL}origin`).length || objectTerms(rule, `${ACL}agentGroup`).size)
      continue;
    const matches =
      (agent !== undefined && iris(rule, `${ACL}agent`).includes(agent)) ||
      iris(rule, `${ACL}agentClass`).includes("http://xmlns.com/foaf/0.1/Agent") ||
      (agent !== undefined && iris(rule, `${ACL}agentClass`).includes(`${ACL}AuthenticatedAgent`));
    if (!matches) continue;
    for (const mode of iris(rule, `${ACL}mode`))
      for (const known of ["Read", "Write", "Append", "Control"] as const)
        if (mode === `${ACL}${known}`) modes.add(known);
  }
  if (modes.has("Write")) modes.add("Append");
  return modes;
}
export async function containerDocument(
  url: string,
  children: readonly { url: string; container: boolean; size: number }[],
): Promise<string> {
  const dataset = new Store(
    buildListingDataset(
      url,
      children.map((child) => ({
        url: child.url,
        title: "Stored message",
        modified: null,
        size: child.size,
        contentType: null,
        types: child.container
          ? [`${LDP}Resource`, `${LDP}Container`, `${LDP}BasicContainer`]
          : [`${LDP}Resource`],
      })),
    ),
  );
  const root = new TermWrapper(url, dataset, DataFactory);
  for (const type of ["Resource", "Container", "BasicContainer"])
    addIriTriple(root, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${LDP}${type}`);
  return serialize([...dataset]);
}
export async function inboxDescription(actor: string, inbox: string): Promise<string> {
  const dataset = new Store();
  addIriTriple(
    new TermWrapper(actor, dataset, DataFactory),
    "http://www.w3.org/ns/ldp#inbox",
    inbox,
  );
  return serialize([...dataset]);
}
export async function readInboxDescription(
  body: string,
  url: string,
  actor: string,
): Promise<string> {
  const dataset = await parseRdf(body, "text/turtle", {
    baseIRI: url,
    maxBytes: 65536,
    maxQuads: 1024,
  });
  const values = iris(new TermWrapper(actor, dataset, DataFactory), `${LDP}inbox`);
  if (values.length !== 1) throw new Error("The receiver description must name one inbox");
  return values[0] as string;
}
