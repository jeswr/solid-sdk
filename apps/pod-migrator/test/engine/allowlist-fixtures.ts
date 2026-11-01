// AUTHORED-BY Codex GPT-6
import {
  LiteralAs,
  LiteralFrom,
  NamedGraphDataset,
  SetFrom,
  TermAs,
  TermFrom,
} from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { ACL, ACP, RDF, RdfNode } from "../../src/engine/rdf.js";
import type { FakePod } from "./fake-pod.js";
import { acl } from "./helpers.js";

export const acceptedTargets = [
  "owner-lock",
  "typed-root",
  "agent",
  "public",
  "authenticated",
  "append",
  "write",
  "control-mode",
  "denial",
  "write-denial",
  "exclusion",
  "acr-denial",
  "untyped",
  "blank-nodes",
] as const;
export const rejectedTargets = [
  "acr-append",
  "acr-read",
  "acr-write",
  "acr-control",
  "acr-empty",
  "acr-no-read",
  "acr-no-write",
  "acl-mode",
  "unknown-mode",
  "mixed-modes",
  "acl-denial",
  "deny-write",
  "deny-append",
  "public-client",
  "public-client-denial",
  "client",
  "issuer",
  "vc",
  "owner",
  "creator",
  "unknown-agent",
  "anyOf",
  "no-positive",
  "empty-matcher",
  "multiple-agents",
  "allow-and-deny",
  "multiple-policies",
  "empty-control",
  "extra-policy",
  "extra-matcher",
  "extra-control",
  "extra-root",
  "extra-type",
  "literal-type",
  "detached",
  "foreign-binding",
  "multiple-bindings",
  "multiple-roots",
  "no-root",
  "untyped-unbound",
  "role-alias",
  "named-graph",
] as const;

/** Start from the emitted owner lock, then independently author one candidate shape. */
export async function targetFixture(pod: FakePod, shape: string): Promise<Store> {
  pod.setAcl(pod.root, await acl(pod, pod.root));
  const dataset = (await pod.dataset(pod.root)) as Store;
  const n = (id: string) =>
    new RdfNode(
      shape === "blank-nodes" && id.startsWith("urn:")
        ? DataFactory.blankNode(id.slice(4))
        : DataFactory.namedNode(id),
      dataset,
      DataFactory,
    );
  const root = n(pod.acl(pod.root));
  const ac = n("urn:allowlist:control");
  const p = n("urn:allowlist:policy");
  const m = n("urn:allowlist:matcher");
  const remove = (subject: RdfNode, predicate?: string) => {
    for (const q of [
      ...dataset.match(
        subject.termType === "BlankNode"
          ? DataFactory.blankNode(subject.value)
          : DataFactory.namedNode(subject.value),
        predicate ? DataFactory.namedNode(predicate) : null,
      ),
    ])
      dataset.delete(q);
  };
  if (shape === "owner-lock") return dataset;
  if (shape === "typed-root" || shape === "untyped-unbound") {
    remove(root, `${ACP}resource`);
    if (shape === "untyped-unbound") remove(root, `${RDF}type`);
    return dataset;
  }
  root.add(`${ACP}memberAccessControl`, ac.value);
  ac.add(`${ACP}apply`, p.value);
  p.add(`${ACP}allow`, `${ACP}Read`);
  p.add(`${ACP}allOf`, m.value);
  m.add(
    `${ACP}agent`,
    shape === "public"
      ? `${ACP}PublicAgent`
      : shape === "authenticated"
        ? `${ACP}AuthenticatedAgent`
        : "urn:stranger",
  );
  if (shape === "blank-nodes") {
    // RdfNode.add writes IRIs. Connect blank nodes through the typed node accessor instead.
    remove(root, `${ACP}memberAccessControl`);
    remove(ac);
    remove(p);
    const link = (from: RdfNode, predicate: string, to: RdfNode) =>
      SetFrom.subjectPredicate(from, predicate, TermAs.instance(RdfNode), TermFrom.instance).add(
        to,
      );
    link(root, `${ACP}memberAccessControl`, ac);
    link(ac, `${ACP}apply`, p);
    p.add(`${ACP}allow`, `${ACP}Read`);
    link(p, `${ACP}allOf`, m);
  }
  if (["append", "write", "control-mode", "acl-mode", "unknown-mode"].includes(shape)) {
    remove(p, `${ACP}allow`);
    p.add(
      `${ACP}allow`,
      shape === "acl-mode"
        ? `${ACL}Read`
        : shape === "unknown-mode"
          ? "urn:UnknownMode"
          : ACP + (shape === "append" ? "Append" : shape === "write" ? "Write" : "Control"),
    );
  }
  if (shape === "mixed-modes") p.add(`${ACP}deny`, `${ACL}Read`);
  if (shape === "acl-denial") {
    remove(p, `${ACP}allow`);
    p.add(`${ACP}deny`, `${ACL}Read`);
  }
  if (shape === "public-client-denial") {
    remove(p, `${ACP}allow`);
    p.add(`${ACP}deny`, `${ACP}Read`);
    m.add(`${ACP}client`, `${ACP}PublicClient`);
  }
  if (shape === "denial") {
    remove(p, `${ACP}allow`);
    p.add(`${ACP}deny`, `${ACP}Read`);
  }
  if (shape === "deny-write" || shape === "deny-append" || shape === "write-denial") {
    remove(p, `${ACP}allow`);
    p.add(`${ACP}deny`, shape === "deny-append" ? `${ACP}Append` : `${ACP}Write`);
    if (shape === "write-denial") p.add(`${ACP}deny`, `${ACP}Append`);
  }
  if (shape === "exclusion") {
    p.add(`${ACP}noneOf`, "urn:excluded");
    n("urn:excluded").add(`${ACP}agent`, "urn:excepted");
  }
  if (shape.startsWith("acr-")) {
    remove(root, `${ACP}memberAccessControl`);
    remove(ac);
    remove(p, `${ACP}allow`);
    root.add(`${ACP}memberAccess`, p.value);
    if (shape !== "acr-empty")
      p.add(
        ACP + (shape === "acr-denial" ? "deny" : "allow"),
        ACP +
          (shape === "acr-append"
            ? "Append"
            : shape === "acr-write"
              ? "Write"
              : shape === "acr-control"
                ? "Control"
                : "Read"),
      );
    if (shape === "acr-denial") p.add(`${ACP}deny`, `${ACP}Write`);
    if (shape === "acr-no-read") {
      remove(p, `${ACP}allow`);
      p.add(`${ACP}allow`, `${ACP}Write`);
    }
    if (shape === "acr-no-read" || shape === "acr-no-write") p.add(`${ACP}allow`, `${ACP}Control`);
  }
  if (["public-client", "client", "issuer", "vc"].includes(shape))
    m.add(
      ACP + (shape === "public-client" ? "client" : shape),
      shape === "public-client" ? `${ACP}PublicClient` : "urn:condition",
    );
  if (["owner", "creator", "unknown-agent"].includes(shape)) {
    remove(m);
    m.add(
      `${ACP}agent`,
      ACP +
        (shape === "owner" ? "OwnerAgent" : shape === "creator" ? "CreatorAgent" : "UnknownAgent"),
    );
  }
  if (shape === "anyOf") {
    remove(p, `${ACP}allOf`);
    p.add(`${ACP}anyOf`, m.value);
  }
  if (shape === "no-positive") {
    remove(p, `${ACP}allOf`);
    p.add(`${ACP}noneOf`, m.value);
  }
  if (shape === "empty-matcher") remove(m);
  if (shape === "multiple-agents") m.add(`${ACP}agent`, "urn:other");
  if (shape === "allow-and-deny") p.add(`${ACP}deny`, `${ACP}Read`);
  if (shape === "multiple-policies") ac.add(`${ACP}apply`, "urn:second");
  if (shape === "empty-control") remove(ac);
  if (shape.startsWith("extra-")) {
    if (shape === "extra-type") p.add(`${RDF}type`, "urn:UnknownType");
    else
      (shape === "extra-policy"
        ? p
        : shape === "extra-matcher"
          ? m
          : shape === "extra-control"
            ? ac
            : root
      ).add("urn:extension", "urn:value");
  }
  if (shape === "detached") n("urn:detached").add(`${ACP}agent`, "urn:stranger");
  if (shape === "literal-type")
    SetFrom.subjectPredicate(p, `${RDF}type`, LiteralAs.string, LiteralFrom.string).add(
      "unestablished type",
    );
  if (shape === "foreign-binding") {
    remove(root, `${ACP}resource`);
    root.add(`${ACP}resource`, "urn:elsewhere");
  }
  if (shape === "multiple-bindings") root.add(`${ACP}resource`, "urn:elsewhere");
  if (shape === "multiple-roots") n("urn:root").add(`${RDF}type`, `${ACP}AccessControlResource`);
  if (shape === "no-root") {
    remove(root, `${ACP}resource`);
    remove(root, `${RDF}type`);
  }
  if (shape === "role-alias") root.add(`${ACP}access`, ac.value);
  if (shape === "named-graph") {
    const graph = new NamedGraphDataset(DataFactory.namedNode("urn:graph"), dataset, DataFactory);
    new RdfNode(p.value, graph, DataFactory).add(`${ACP}allow`, `${ACP}Read`);
  }
  if (shape === "untyped")
    for (const q of [...dataset.match(null, DataFactory.namedNode(`${RDF}type`))])
      dataset.delete(q);
  return dataset;
}
