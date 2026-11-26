// AUTHORED-BY Codex GPT-6.1-Sol
import { createFactAssertion, type Fact, NanopubStore } from "@jeswr/pkg-memory";
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { expect, it, vi } from "vitest";
import {
  correctHealthFact,
  forgetHealthFact,
  HealthGraphError,
  projectHealthFacts,
} from "../src/index.js";
import { batch, claim, condition, medication, other, owner } from "./helpers.js";

function fixtureStore() {
  const port = createMemoryPodPort({ root: "https://example.org/pod/", webId: owner });
  const pod = {
    ...port,
    async head(target: string) {
      return { acl: `${target}.acl` };
    },
  };
  return { store: new NanopubStore(pod), pod };
}
const options = {
  clientId: "https://example.org/agents/client",
  batchId: "correction-batch",
  generatedAt: "2026-11-11T12:00:00Z",
};
it("forget appends a Retracted revision and keeps original resource bytes", async () => {
  const { store, pod } = fixtureStore();
  const original = await batch([claim("original", medication())]);
  await store.put(original);
  const id = original.nanopubs[0]?.id as string;
  const bytes = await pod.read(store.url(id));
  const withdrawal = await forgetHealthFact(store, id, { ...options, batchId: "withdrawal-batch" });
  const view = projectHealthFacts(await store.list(), { owner });
  expect(withdrawal.nanopubs[0]?.validity).toBe("Retracted");
  expect(view.facts).toHaveLength(2);
  expect(view.facts.every((f) => f.belief === "past")).toBe(true);
  expect(view.facts.find((f) => f.id === id)?.replacedBy).toEqual([withdrawal.nanopubs[0]?.id]);
  expect((await pod.read(store.url(id))).body).toEqual(bytes.body);
});
it.each([
  "condition",
  "allergy",
  "medication",
] as const)("corrects %s append-only, preserving the exact assertion revision target", async (template) => {
  const { store, pod } = fixtureStore();
  const fact: Fact =
    template === "medication"
      ? medication()
      : template === "allergy"
        ? {
            template,
            value: {
              id: "https://example.org/entities/allergy",
              name: "Fictional original allergy",
            },
          }
        : {
            template,
            value: {
              id: "https://example.org/entities/condition",
              name: "Fictional original",
              code: { id: "https://example.org/entities/code", value: "EX" },
            },
          };
  const original = await batch([claim("original", fact)]);
  await store.put(original);
  const np = original.nanopubs[0];
  if (!np) throw new Error("Missing fixture");
  const bytes = await pod.read(store.url(np.id));
  const corrected: Fact =
    template === "medication"
      ? {
          template,
          value: {
            id: "https://example.org/entities/medication",
            medication: {
              id: "https://example.org/entities/product",
              name: "Fictional corrected product",
              atcCode: "R03AA00",
            },
            dose: { value: "1.00", unit: "mg" },
          },
        }
      : template === "allergy"
        ? {
            template,
            value: {
              id: "https://example.org/entities/allergy",
              name: "Fictional corrected allergy",
            },
          }
        : condition("Fictional corrected");
  const result = await correctHealthFact(store, np.id, corrected, options);
  expect(result.nanopubs).toHaveLength(1);
  expect(result.nanopubs[0]?.supersedes).toEqual([np.assertionId]);
  const view = projectHealthFacts(await store.list(), { owner });
  expect(view.facts).toHaveLength(2);
  expect(view.facts.find((f) => f.id === np.id)).toMatchObject({
    belief: "past",
    replacedBy: [result.nanopubs[0]?.id],
  });
  expect(view.facts.find((f) => f.id !== np.id)).toMatchObject({
    belief: "definitely",
    epistemic: "SelfReportedExplicit",
    provenance: {
      attributedTo: [owner],
      evidence: [{ quote: "Correction supplied by the owner." }],
    },
  });
  expect((await pod.read(store.url(np.id))).body).toEqual(bytes.body);
});
it("rejects unsupported corrections, foreign patients, earlier clocks and redacts backend errors", async () => {
  const { store, pod } = fixtureStore();
  await expect(
    correctHealthFact(store, "secret", { template: "email", value: "secret@example.org" }, options),
  ).rejects.toMatchObject({ code: "unsupported-correction" });
  const foreign = await batch([
    { ...claim("foreign"), assertion: createFactAssertion(other, condition()) },
  ]);
  await store.put(foreign);
  await expect(
    correctHealthFact(store, foreign.nanopubs[0]?.id as string, condition(), options),
  ).rejects.toMatchObject({ code: "invalid-correction" });
  const original = await batch([claim("owner")], "owner-batch");
  await store.put(original);
  await expect(
    correctHealthFact(store, original.nanopubs[0]?.id as string, condition(), {
      ...options,
      generatedAt: "2020-01-01T00:00:00Z",
    }),
  ).rejects.toMatchObject({ code: "invalid-correction" });
  vi.spyOn(pod, "read").mockRejectedValue(new Error("secret private values"));
  await expect(
    forgetHealthFact(store, original.nanopubs[0]?.id as string, options),
  ).rejects.toThrow("write-failed");
  await expect(
    correctHealthFact(store, original.nanopubs[0]?.id as string, condition(), options),
  ).rejects.toThrow(HealthGraphError);
});
it("supports an unchanged correction and the default clock without revising other immutable bytes", async () => {
  const { store } = fixtureStore();
  const original = await batch([claim("original")]);
  await store.put(original);
  const id = original.nanopubs[0]?.id as string;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T00:00:00Z"));
  try {
    const corrected = await correctHealthFact(store, id, condition(), {
      clientId: options.clientId,
      batchId: "same-correction",
    });
    const view = projectHealthFacts(await store.list(), { owner });
    expect(view.facts.find((f) => f.id === id)?.belief).toBe("past");
    expect(view.facts.find((f) => f.id === corrected.nanopubs[0]?.id)?.belief).toBe("definitely");
  } finally {
    vi.useRealTimers();
  }
});
