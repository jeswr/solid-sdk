// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers

import { parseRdf } from "@jeswr/fetch-rdf";
import { canonicalNQuads } from "@jeswr/solid-vc";
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import type { AnyMessage } from "../src/core/types.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { testKey } from "../src/reference/keys.js";
import { AgentRuntime, type OutboundMessage } from "../src/runtime/agent.js";
import { type Authenticity, sign, verify } from "../src/wire/authenticity.js";
import { readDocument, toTrig, writeDocument } from "../src/wire/document.js";
import type { PublicKeyRecord } from "../src/wire/jws-compact.js";

const folder = new URL("./fixtures/whole-messages/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8")) as {
  fixtures: {
    file: string;
    suite: Authenticity;
    verificationMethod: string;
    key: PublicKeyRecord;
    source: AnyMessage;
  }[];
};
it("fixtures are actual propose, evidence-bearing deliver and invoke packets from mortgage-core main", async () => {
  const messages: AnyMessage[] = [];
  const proto = AgentRuntime.prototype as unknown as {
    emit(...args: unknown[]): Promise<OutboundMessage>;
  };
  const emit = proto.emit;
  const hook = vi.spyOn(proto, "emit").mockImplementation(async function (
    this: typeof proto,
    ...args
  ) {
    const out = await emit.apply(this, args);
    messages.push(out.message);
    return out;
  });
  try {
    const root = new URL("../", import.meta.url).pathname;
    const { profile, scenario } = loadCase(root, "mortgage-core");
    await runScenario(profile, scenario);
  } finally {
    hook.mockRestore();
  }
  expect(manifest.fixtures).toHaveLength(6);
  for (const fixture of manifest.fixtures) {
    expect(messages.find((message) => message.id === fixture.source.id)).toStrictEqual(
      fixture.source,
    );
    expect(fixture.source.id).toContain("mortgage-core-main");
    if (fixture.source.kind === "deliver")
      expect(fixture.source.evidence?.length).toBeGreaterThan(0);
  }
});
for (const fixture of manifest.fixtures)
  it(`verifies, admits and reproduces ${fixture.file}`, async () => {
    const document = JSON.parse(readFileSync(new URL(fixture.file, folder), "utf8"));
    const resolve = (id: string) =>
      id === fixture.key.kid || id === fixture.verificationMethod ? fixture.key : undefined;
    const checked = await verify(JSON.stringify(document), "application/ld+json", {
      suite: fixture.suite,
      resolve,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error(checked.detail);
    expect(MessageNode.fromNode(new MessageNode(checked.root, checked.dataset))).toStrictEqual(
      fixture.source,
    );
    const graph = MessageNode.toNode(fixture.source);
    const unsigned = await readDocument(
      JSON.stringify(await writeDocument(graph)),
      "application/ld+json",
    );
    expect(unsigned.ok).toBe(true);
    const party = fixture.source.from.actor?.includes("northbank") ? "north-agent" : "sam-agent";
    const key = await testKey(`engine/${party}/actor`);
    expect(key.publicJwk).toEqual(fixture.key.publicJwk);
    const reproduced = await sign(graph, {
      suite: fixture.suite,
      key,
      verificationMethod: fixture.verificationMethod,
      created: fixture.source.createdAt,
    });
    expect(reproduced).toEqual(document);
    expect(
      await verify(
        JSON.stringify({ ...document, createdAt: "2026-11-13T09:00:01.000Z" }),
        "application/ld+json",
        { suite: fixture.suite, resolve },
      ),
    ).toMatchObject({ ok: false, reason: "bad-signature" });
    expect(
      await verify(JSON.stringify(document), "application/ld+json", {
        suite: fixture.suite,
        resolve: () => undefined,
      }),
    ).toMatchObject({ ok: false, reason: "unknown-key" });
    if (fixture.suite === "data-integrity") {
      const trig = await toTrig(checked.dataset);
      const round = await parseRdf(trig, "application/trig");
      expect(await canonicalNQuads([...round])).toBe(await canonicalNQuads([...checked.dataset]));
      const rewritten = await writeDocument({ id: checked.root, dataset: round });
      expect(
        await verify(JSON.stringify(rewritten), "application/ld+json", {
          suite: fixture.suite,
          resolve,
        }),
      ).toMatchObject({ ok: true });
    }
  });
