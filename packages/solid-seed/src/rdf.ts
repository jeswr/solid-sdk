// AUTHORED-BY GPT-5.6 Sol via codex

import type {
  DatasetCore,
  Quad,
  Quad_Graph,
  Quad_Object,
  Quad_Predicate,
  Quad_Subject,
  Term,
} from "@rdfjs/types";
import { Authorization } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { assertHttpIri } from "./iri.js";
import type { AccessMode, AccessSpec } from "./types.js";

const ACL = "http://www.w3.org/ns/auth/acl#";

function termKey(term: Term): string {
  if (term.termType === "Literal") {
    return `L:${term.value}:${term.language}:${term.datatype.value}`;
  }
  return `${term.termType}:${term.value}`;
}

function quadKey(value: Quad): string {
  return [value.graph, value.subject, value.predicate, value.object].map(termKey).join("\u0000");
}

export function serializeRdf(quads: readonly Quad[], baseIri: string): Promise<string> {
  const sorted = [...quads].sort((left, right) => quadKey(left).localeCompare(quadKey(right)));
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle", baseIRI: baseIri });
    writer.addQuads(sorted);
    writer.end((error, result) => {
      if (error === null) resolve(result);
      else reject(error);
    });
  });
}

function setModes(auth: Authorization, modes: readonly AccessMode[]): void {
  auth.canRead = modes.includes("read");
  auth.canWrite = modes.includes("write");
  auth.canAppend = modes.includes("append");
  auth.canReadWriteAcl = modes.includes("control");
}

function aim(auth: Authorization, resourceUrl: string): void {
  auth.type.add(`${ACL}Authorization`);
  auth.accessTo = resourceUrl;
  if (resourceUrl.endsWith("/")) auth.default = resourceUrl;
}

/** Author a complete WAC resource ACL exclusively through @solid/object wrappers. */
export function buildAclDataset(
  aclUrl: string,
  resourceUrl: string,
  ownerWebid: string,
  access: AccessSpec,
): DatasetCore {
  assertHttpIri(aclUrl, "ACL URL");
  assertHttpIri(resourceUrl, "ACL resource URL");
  assertHttpIri(ownerWebid, "ACL owner WebID", { allowFragment: true });
  const dataset = new Store();
  const owner = new Authorization(`${aclUrl}#owner`, dataset, DataFactory);
  aim(owner, resourceUrl);
  owner.agent.add(ownerWebid);
  setModes(owner, ["read", "write", "control"]);

  if (access.publicRead === true) {
    const publicRule = new Authorization(`${aclUrl}#public`, dataset, DataFactory);
    aim(publicRule, resourceUrl);
    publicRule.accessibleToAny = true;
    setModes(publicRule, ["read"]);
  }

  for (const [index, grant] of (access.agents ?? []).entries()) {
    assertHttpIri(grant.webid, `ACL agent ${index} WebID`, { allowFragment: true });
    const rule = new Authorization(`${aclUrl}#agent-${index}`, dataset, DataFactory);
    aim(rule, resourceUrl);
    rule.agent.add(grant.webid);
    setModes(rule, grant.modes);
  }
  return dataset as unknown as DatasetCore;
}

export async function serializeAcl(
  aclUrl: string,
  resourceUrl: string,
  ownerWebid: string,
  access: AccessSpec,
): Promise<string> {
  return serializeRdf([...buildAclDataset(aclUrl, resourceUrl, ownerWebid, access)], aclUrl);
}

function replaceTerm(
  term: Term,
  replacements: ReadonlyMap<string, string>,
  placeholderBase: string,
): Term {
  if (term.termType !== "NamedNode") return term;
  const replacement = replacements.get(term.value);
  if (replacement !== undefined) return DataFactory.namedNode(replacement);
  if (term.value.startsWith(placeholderBase)) {
    throw new Error(`Unmapped placeholder-base IRI cannot be written: ${term.value}`);
  }
  return term;
}

export function rebaseQuads(
  quads: readonly Quad[],
  replacements: ReadonlyMap<string, string>,
  placeholderBase: string,
): Quad[] {
  return quads.map((value) =>
    DataFactory.quad(
      replaceTerm(value.subject, replacements, placeholderBase) as Quad_Subject,
      replaceTerm(value.predicate, replacements, placeholderBase) as Quad_Predicate,
      replaceTerm(value.object, replacements, placeholderBase) as Quad_Object,
      replaceTerm(value.graph, replacements, placeholderBase) as Quad_Graph,
    ),
  );
}
