// AUTHORED-BY Codex GPT-6.1-Sol

import { readWac } from "@jeswr/pod-access";
import type { RdfReadResult } from "@jeswr/storage-client";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store, type Term } from "n3";

const ACL = "http://www.w3.org/ns/auth/acl#";
type Dataset = RdfReadResult["dataset"];
/** Symbolic group identities on this resource, including its member scope. */
export function wacGroupIds(dataset: Dataset, resource: string, source: string): string[] {
  if (!dataset.match(null, DataFactory.namedNode(`${ACL}agentGroup`)).size) return [];
  const policy = readWac(dataset, resource, source);
  return [
    ...new Set(
      policy.grants.flatMap((grant) =>
        grant.who.flatMap((clause) =>
          clause.flatMap((subject) => (subject.kind === "group" ? [subject.group] : [])),
        ),
      ),
    ),
  ].sort();
}
class Rule extends Authorization {
  get groups() {
    return SetFrom.subjectPredicate(
      this,
      `${ACL}agentGroup`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get classes() {
    return SetFrom.subjectPredicate(
      this,
      `${ACL}agentClass`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
/** A people-only projection for legacy dialogs, whose independent group section owns group edits. */
export function peopleWac(dataset: Dataset): Store {
  for (const quad of dataset)
    if (quad.graph.termType !== "DefaultGraph") throw new Error("Named graph WAC is unsupported");
  const copy = new Store([...dataset]);
  for (const auth of new AclResource(copy, DataFactory).authorizations) {
    const rule = new Rule(auth as unknown as Term, copy, DataFactory);
    if (![...rule.groups].length) continue;
    rule.groups.clear();
    if (!rule.agent.size && !rule.classes.size)
      for (const quad of [...copy.match(auth as unknown as Term)]) copy.delete(quad);
  }
  return copy;
}
/** Retain symbolic group selectors while a legacy dialog replaces its person grants. */
export function preserveGroupWac(dataset: Dataset, original: Dataset): Store {
  const copy = new Store([...dataset]);
  for (const auth of new AclResource(original, DataFactory).authorizations) {
    const source = new Rule(auth as unknown as Term, original, DataFactory);
    if (![...source.groups].length) continue;
    if (copy.match(auth as unknown as Term).size)
      throw new Error("Group authorization identifier collision");
    for (const quad of original.match(auth as unknown as Term)) copy.add(quad);
    const rule = new Rule(auth as unknown as Term, copy, DataFactory);
    rule.agent.clear();
    rule.classes.clear();
  }
  return copy;
}
