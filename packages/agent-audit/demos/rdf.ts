// AUTHORED-BY Codex GPT-6.1-Sol
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { AuditFetch } from "../dist/index.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
class Resource extends TermWrapper {
  iris(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
export function aclDocument(target: string, owner: string, publicRead = false): Promise<string> {
  const store = new Store();
  for (const [name, principal, modes] of [
    ["owner", owner, ["Read", "Write", "Control"]],
    ...(publicRead ? [["auditor", "http://xmlns.com/foaf/0.1/Agent", ["Read"]]] : []),
  ] as [string, string, string[]][]) {
    const rule = new Resource(DataFactory.namedNode(`${target}.acl#${name}`), store, DataFactory);
    rule.iris(RDF_TYPE).add(`${ACL}Authorization`);
    rule.iris(`${ACL}accessTo`).add(target);
    if (target.endsWith("/")) rule.iris(`${ACL}default`).add(target);
    rule.iris(`${ACL}${name === "owner" ? "agent" : "agentClass"}`).add(principal);
    for (const mode of modes) rule.iris(`${ACL}mode`).add(`${ACL}${mode}`);
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "Turtle" });
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
export async function put(io: AuditFetch, url: string, body: string, contentType = "text/turtle") {
  const response = await io(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
    credentials: "omit",
    redirect: "manual",
  });
  if (!response.ok) throw new Error("Demo resource write failed");
}
export async function grantRead(io: AuditFetch, target: string, owner: string) {
  await put(io, `${target}.acl`, await aclDocument(target, owner, true));
}
export async function container(io: AuditFetch, target: string, owner: string) {
  // The newly created CSS pod already has an owner-only inherited ACL.
  const response = await io(target, {
    method: "PUT",
    headers: {
      "content-type": "text/turtle",
      link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
    body: "",
    credentials: "omit",
    redirect: "manual",
  });
  if (!response.ok) throw new Error("Demo container creation failed");
  await put(io, `${target}.acl`, await aclDocument(target, owner));
}
