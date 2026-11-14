// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers

import { canonicalNQuads } from "@jeswr/solid-vc";
import { readFileSync, writeFileSync } from "fs";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { BoundsError, resolveLimits } from "../src/core/limits.js";
import { materializeAttachments } from "../src/model/attachments.js";
import { ActionIntentNode, AgreementNode, MessageNode } from "../src/model/message-nodes.js";
import { readAttachmentDocument, writeAttachmentDocument } from "../src/wire/attachments.js";
import { readDocument, writeDocument } from "../src/wire/document.js";
import { captureModelCorpus } from "./helpers/model-corpus.js";

it("round-trips every executable trace packet, action intent and agreement through RDF and shapes", async () => {
  const corpus = await captureModelCorpus();
  const failures: { type: string; field: string; error: string }[] = [];
  let messages = 0,
    intents = 0,
    agreements = 0;
  const capacity: {
    type: string;
    field: string;
    reason: string;
    sourceDigest: string;
    bytes?: number;
  }[] = [];
  const required = JSON.parse(
    readFileSync(new URL("fixtures/message-model-capacity.json", import.meta.url), "utf8"),
  ) as {
    capacity: { type: string; field: string }[];
  };
  expect(required.capacity).toHaveLength(26);
  const requiredCounts = new Map<string, number>();
  for (const item of required.capacity) {
    const key = item.type + "\0" + item.field;
    requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
  }
  const carriageCounts = new Map<string, number>();
  // Test-only capacity for the expanded representation. Default carriage bounds
  // remain unchanged and every refusal at those bounds is recorded separately.
  const expandedLimits = resolveLimits({
    maxEnvelopeBytes: 1_048_576,
    maxStringLength: 262_144,
    maxJsonNodes: 50_000,
    maxArrayLength: 8192,
  });
  async function check<T>(
    type: string,
    field: string,
    value: T,
    toNode: (object: T) => { id: string; dataset: import("n3").Store; toObject(): T },
  ): Promise<void> {
    try {
      const node = toNode(value);
      expect(node.toObject()).toStrictEqual(value);
      const key = type + "\0" + field;
      let carriageChecked = false;
      const checkCarriage = async () => {
        if (carriageChecked) return;
        const packet = await writeAttachmentDocument(node);
        const transported = await readAttachmentDocument(
          JSON.stringify(packet.document),
          packet.attachments,
        );
        if (!transported.ok) throw new Error(`Attachment carriage: ${transported.detail}`);
        expect(await canonicalNQuads([...materializeAttachments(transported.dataset)])).toBe(
          await canonicalNQuads([...node.dataset]),
        );
        const AttachedView = node.constructor as new (
          id: string,
          dataset: import("n3").Store,
        ) => typeof node;
        expect(new AttachedView(transported.root, transported.dataset).toObject()).toStrictEqual(
          value,
        );
        carriageChecked = true;
        carriageCounts.set(key, (carriageCounts.get(key) ?? 0) + 1);
      };
      // Pin all 26 original capacity occurrences, even if a later compact proof fits inline.
      if (requiredCounts.has(key)) await checkCarriage();
      let limits: import("../src/core/limits.js").PilotLimits | undefined;
      let doc: import("../src/wire/document.js").JsonLdDocument;
      try {
        doc = await writeDocument(node);
      } catch (error) {
        if (!(error instanceof BoundsError)) throw error;
        capacity.push({ type, field, reason: error.code, sourceDigest: digestOf(value) });
        await checkCarriage();

        limits = expandedLimits;
        doc = await writeDocument(node, { limits });
        capacity[capacity.length - 1]!.bytes = Buffer.byteLength(JSON.stringify(doc));
      }
      const read = await readDocument(JSON.stringify(doc), "application/ld+json", { limits });
      if (!read.ok) throw new Error(`${read.reason}: ${read.detail}`);
      expect(await canonicalNQuads([...read.dataset])).toBe(
        await canonicalNQuads([...node.dataset]),
      );
      const View = node.constructor as new (id: string, dataset: import("n3").Store) => typeof node;
      expect(new View(read.root, read.dataset).toObject()).toStrictEqual(value);
    } catch (error) {
      failures.push({ type, field, error: (error as Error).message });
    }
  }
  for (const item of corpus.messages) {
    await check(
      "Message/" + item.message.kind,
      item.scenario + "/" + item.message.id,
      item.message,
      MessageNode.toNode,
    );
    messages++;
  }
  for (const intent of corpus.intents) {
    await check("ActionIntent", intent.operation, intent, ActionIntentNode.toNode);
    intents++;
  }
  for (const agreement of corpus.agreements) {
    await check("Agreement", agreement.id, agreement, AgreementNode.toNode);
    agreements++;
  }
  const report = {
    packets: corpus.packets,
    paths: corpus.paths,
    messages,
    intents,
    agreements,
    expandedLimits,
    capacity,
    failures,
  };
  if (process.env.BRIEF22C_MODEL_REPORT)
    writeFileSync(process.env.BRIEF22C_MODEL_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  expect(corpus.paths).toBeGreaterThanOrEqual(165);
  expect(messages).toBeGreaterThan(500);
  expect(intents).toBeGreaterThan(100);
  expect(agreements).toBeGreaterThan(10);
  expect(failures).toEqual([]);
  for (const [key, count] of requiredCounts)
    expect(carriageCounts.get(key) ?? 0, key).toBeGreaterThanOrEqual(count);
}, 2_700_000);
