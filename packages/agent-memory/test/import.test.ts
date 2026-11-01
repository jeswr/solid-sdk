// AUTHORED-BY Codex GPT-6.1-Sol
import { parseNanopublications } from "@jeswr/pkg-memory";
import { expect, it, vi } from "vitest";
import { createAgentMemory } from "../src/index.js";
import { CONTAINER, harness, OWNER, QUERY } from "./helpers.js";

const input = {
  commit: "a".repeat(40),
  source: "https://example.org/registry/rules/communication-rules.yaml",
  yaml: 'rules:\n  - id: meetings\n    rule: "Prefer afternoon meetings."\n  - id: contact\n    rule: "Use email for nonurgent contact."\n',
};
it("imports once with explicit owner attribution and pinned revision, then recalls only after approval", async () => {
  const h = await harness();
  const proposal = await h.memory.importCommunicationRules(input);
  const data = await parseNanopublications(proposal.trig);
  expect(data.nanopubs).toHaveLength(2);
  for (const np of data.nanopubs)
    expect(np).toMatchObject({
      epistemic: "SelfReportedExplicit",
      validity: "Current",
      attributedTo: [OWNER],
    });
  expect(proposal.trig).toContain(`communication-rules.yaml@${input.commit}`);
  expect(proposal.trig).toContain(input.source);
  expect(await h.memory.recall(QUERY)).toEqual([]);
  await h.memory.approveRemember(proposal.id, await h.sign(proposal));
  expect(await h.memory.recall(QUERY)).toHaveLength(2);
  const queue = vi.fn();
  const restarted = createAgentMemory({ ...h.options, queueApproval: queue });
  expect(
    await restarted.importCommunicationRules({
      ...input,
      commit: "b".repeat(40),
      yaml: "rules: []",
    }),
  ).toEqual(proposal);
  expect(queue).not.toHaveBeenCalled();
  expect((await h.storage.list(CONTAINER)).items.filter((e) => e.kind === "resource")).toHaveLength(
    1,
  );
});
it("deduplicates concurrent imports across instances and requeues pending imports after restart", async () => {
  const h = await harness();
  const second = createAgentMemory(h.options);
  const [left, right] = await Promise.all([
    h.memory.importCommunicationRules(input),
    second.importCommunicationRules(input),
  ]);
  expect(left).toEqual(right);
  expect((await h.storage.list(`${CONTAINER}pending/`)).items).toHaveLength(1);
  const queue = vi.fn();
  expect(
    await createAgentMemory({ ...h.options, queueApproval: queue }).importCommunicationRules(input),
  ).toEqual(left);
  expect(queue).toHaveBeenCalledWith(left);
});
it("preserves pending imports after queue failure so the original content can be requeued", async () => {
  const h = await harness({
    queueApproval: async () => {
      throw new Error("offline queue");
    },
  });
  await expect(h.memory.importCommunicationRules(input)).rejects.toThrow("offline queue");
  const queue = vi.fn();
  const result = await createAgentMemory({
    ...h.options,
    queueApproval: queue,
  }).importCommunicationRules(input);
  expect(result.nanopublications).toHaveLength(2);
  expect(queue).toHaveBeenCalledOnce();
});
it.each([
  "rules: []",
  "rules: [one]",
  "rules: [{id: same, rule: a}, {id: same, rule: b}]",
  "rules: [{id: a, rule: 12}]",
  "rules: [{id: a, rule: b, secret: unhandled}]",
  "rules: [",
  "rules: []\nrules: []",
  "rules: &alias [{id: a, rule: b}, *alias]",
  "rules: [{id: a, rule: !!unknown text}]",
])("rejects unsupported YAML atomically: %s", async (yaml) => {
  const h = await harness();
  await expect(h.memory.importCommunicationRules({ ...input, yaml })).rejects.toThrow();
  expect((await h.storage.list(`${CONTAINER}pending/`)).items).toHaveLength(0);
});
it("rejects unpinned sources and oversized import input", async () => {
  const h = await harness();
  await expect(h.memory.importCommunicationRules({ ...input, commit: "main" })).rejects.toThrow(
    "full source commit",
  );
  await expect(
    h.memory.importCommunicationRules({ ...input, yaml: " ".repeat(1_048_577) }),
  ).rejects.toThrow("size limit");
});
