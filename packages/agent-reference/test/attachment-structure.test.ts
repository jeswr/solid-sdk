// AUTHORED-BY Codex GPT-6
import { serialize } from "@jeswr/rdf-serialize";
import { RequiredAs, TermAs, TermFrom } from "@rdfjs/wrapper";
import { Store } from "n3";
import { expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { ActionIntentNode } from "../src/model/message-nodes.js";
import { NamedValueNode, NamedValuesNode, SCHEMA } from "../src/model/named-values.js";
import { readAttachmentDocument, writeAttachmentDocument } from "../src/wire/attachments.js";

it.each([
  "cycle",
  "shared",
  "collision",
  "depth",
  "type",
] as const)("refuses an integrity-bound attachment with a %s violation", async (attack) => {
  const node = ActionIntentNode.toNode({
    operation: "urn:test:operation",
    action: "use",
    target: "urn:test:target",
    conversation: "urn:test:conversation",
    parameters: { request: "x".repeat(20_000) },
  });
  const packet = await writeAttachmentDocument(node);
  const ref = (packet.document["@included"] as Record<string, unknown>[]).find(
    (part) => part.attachmentDigest,
  )!;
  const root = String(ref.id);
  let graph: Store;
  if (attack === "depth") {
    graph = new Store();
    let parent = NamedValuesNode.from({}, root, graph);
    for (let i = 0; i < 18; i++) {
      const child = NamedValuesNode.from({}, "urn:test:collection:" + i, graph);
      const entry = new NamedValueNode("urn:test:entry:" + i, graph);
      entry.initialise("nested", 0);
      entry.domainValue = TermAs.term(child);
      RequiredAs.object(parent, SCHEMA + "itemListElement", entry, TermFrom.instance);
      parent = child;
    }
  } else {
    const tree = NamedValuesNode.from(
      attack === "shared" ? { first: {}, second: "placeholder" } : { request: "placeholder" },
      root,
    );
    graph = tree.dataset;
    if (attack === "cycle") tree.entries[0]!.domainValue = TermAs.term(tree);
    if (attack === "shared") tree.entries[1]!.domainValue = tree.entries[0]!.domainValue;
    if (attack === "collision") {
      graph.deleteMatches(tree.entries[0] as never, undefined, undefined, undefined);
      const entry = new NamedValueNode(node.operation, graph);
      entry.initialise("request", 0);
      entry.domainValue = TermAs.term(tree);
      RequiredAs.object(tree, SCHEMA + "itemListElement", entry, TermFrom.instance);
    }
    if (attack === "type") {
      graph = NamedValuesNode.from(["placeholder"], root).dataset;
    }
  }
  const bytes = Buffer.from(await serialize([...graph], { format: "application/n-quads" }));
  const digest = digestBytes(bytes);
  ref.attachmentDigest = digest;
  ref.byteLength = bytes.byteLength;
  const expected =
    attack === "depth"
      ? "attachment-too-deep"
      : attack === "collision"
        ? "attachment-node-collision"
        : "attachment-invalid-graph";
  expect(
    await readAttachmentDocument(JSON.stringify(packet.document), [
      {
        ...packet.attachments[0]!,
        digest,
        byteLength: bytes.byteLength,
        bytes: bytes.toString("base64"),
      },
    ]),
  ).toMatchObject({ ok: false, detail: expected });
});
