// AUTHORED-BY Codex GPT-6
import { addIriTriple } from "@jeswr/rdf-serialize/wrapper";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import {
  AudienceNode,
  BodyNode,
  generatedEntities,
  MessageNode,
  ParticipantNode,
} from "../src/model/index.js";
import { AWP, PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { readDocument, writeDocument } from "../src/wire/index.js";

it("constructs a proposal entirely through RDF wrappers, writes it, and reads it through live views", async () => {
  const node = MessageNode.create("urn:test:message", "describe");
  node.profile = PILOT_PROFILE;
  node.configuration = "urn:test:configuration";
  node.conversation = "urn:test:conversation";
  node.setWindow(new Date("2026-11-13T10:00:00.000Z"), new Date("2026-11-13T11:00:00.000Z"));
  const sender = new ParticipantNode("urn:test:sender", node.dataset);
  sender.actor = "urn:test:actor";
  sender.operator = "urn:test:operator";
  node.from = sender;
  const recipient = new AudienceNode("urn:test:recipient", node.dataset);
  recipient.actor = "urn:test:peer";
  node.to = recipient;
  const body = new BodyNode("urn:test:body", node.dataset);
  body.want.add("configurations");
  node.body = body;
  const document = await writeDocument(node);
  const admitted = await readDocument(JSON.stringify(document), "application/ld+json");
  expect(admitted.ok).toBe(true);
  if (!admitted.ok) throw new Error(admitted.detail);
  const view = new MessageNode(admitted.root, admitted.dataset);
  expect(view.kind).toBe("describe");
  expect(view.from?.actor).toBe("urn:test:actor");
  expect(view.from?.operator).toBe("urn:test:operator");
  expect(
    admitted.dataset.countQuads(null, DataFactory.namedNode(AWP + "operator"), null, null),
  ).toBe(1);
  expect(
    admitted.dataset.countQuads(
      null,
      DataFactory.namedNode("http://www.w3.org/ns/odrl/2/operator"),
      null,
      null,
    ),
  ).toBe(0);
  expect([...(view.body?.want ?? [])]).toEqual(["configurations"]);
  const another = new MessageNode(node.id, node.dataset);
  node.conversation = "urn:test:changed";
  expect(another.conversation).toBe("urn:test:changed");
  expect(Object.hasOwn(view, "body")).toBe(false);
});

it("refuses unsafe links, cross-dataset links and ambiguous singleton RDF", () => {
  expect(() => MessageNode.create("urn:unsafe:>injection", "describe")).toThrow();
  expect(() => MessageNode.create("urn:test:message", "invented" as never)).toThrow();
  const node = MessageNode.create("urn:test:message", "describe");
  node.conversation = "urn:test:first";
  addIriTriple(node, AWP + "conversation", "urn:test:second");
  expect(() => node.conversation).toThrow("Ambiguous singleton");
  expect(() => {
    node.from = new ParticipantNode(
      "urn:test:foreign",
      MessageNode.create("urn:test:other", "describe").dataset,
    );
  }).toThrow("same dataset");
  expect(() => {
    node.configuration = "urn:unsafe:>injection";
  }).toThrow();
});

it("uses the generated GrantRecord class over the same RDF model and wire boundary", async () => {
  const entity = generatedEntities.GrantRecord;
  const dataset = entity.build("urn:test:grant", {
    at: new Date("2026-11-13T10:00:00.000Z"),
    digest: "sha-256:test",
    grantee: "urn:test:agent",
    grantor: "urn:test:owner",
    kind: "https://w3id.org/jeswr/awp#grant-kind/owner-mandate",
  });
  expect(entity.parse("urn:test:grant", dataset)).toMatchObject({
    grantee: "urn:test:agent",
    kind: "https://w3id.org/jeswr/awp#grant-kind/owner-mandate",
  });
  const wrapper = new entity.Wrapper("urn:test:grant", dataset, DataFactory);
  const document = await writeDocument(wrapper);
  const read = await readDocument(JSON.stringify(document), "application/ld+json");
  expect(read.ok).toBe(true);
  if (!read.ok) throw new Error(read.detail);
  expect(entity.parse(read.root, read.dataset)?.kind).toBe(AWP + "grant-kind/owner-mandate");
});
