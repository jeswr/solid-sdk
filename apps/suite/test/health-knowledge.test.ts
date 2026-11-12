// AUTHORED-BY Codex GPT-6.1-Sol

import type { HealthGraphView } from "@jeswr/pkg-health";
import { projectHealthFacts } from "@jeswr/pkg-health";
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createKnowledgeDemo } from "../src/apps/health/lib/knowledge/demo";
import {
  bodySystemGroups,
  filterFacts,
  formatKnowledgeDate,
  knowledgeStats,
  needsReview,
  sourceCounts,
  timelineCoordinate,
} from "../src/apps/health/lib/knowledge/view-model";

let view: HealthGraphView;
beforeAll(async () => {
  view = projectHealthFacts(await exampleHealthKnowledge(), {
    owner: "https://example.org/people/avery#me",
  });
});
describe("health knowledge presentation", () => {
  it("counts explicit current claims, numeric result series and referenced sources", () => {
    expect(knowledgeStats(view)).toEqual({ conditions: 2, medications: 2, results: 5, sources: 5 });
    const historical = view.facts.find((f) => f.belief === "past");
    if (!historical) throw new Error("Missing historical fixture");
    expect(knowledgeStats({ ...view, facts: [historical] }).conditions).toBe(0);
  });
  it("keeps hedged and contradicted claims in review, newest evidence first", () => {
    const review = needsReview(view);
    expect(review.map((f) => f.label)).toEqual([
      "Asthma report disputed",
      "Asthma reported",
      "Possible sleep apnoea",
    ]);
    const original = review[0];
    if (!original) throw new Error("Missing review fixture");
    const hedged = {
      ...original,
      id: "hedged",
      hedge: "uncertain",
      belief: "definitely" as const,
      provenance: { ...original.provenance, evidence: [], generatedAt: "2027-01-01T00:00:00Z" },
    };
    expect(needsReview({ ...view, facts: [...view.facts, hedged] })[0]?.id).toBe("hedged");
    expect(view.facts).toHaveLength(77);
  });
  it("groups each fact once and takes three distinct labels per body system", () => {
    const groups = bodySystemGroups(view);
    expect(groups.reduce((n, group) => n + group.count, 0)).toBe(77);
    expect(groups.find((g) => g.id === "cardiovascular")?.labels).toContain("Resting heart rate");
    expect(groups.every((g) => g.labels.length <= 3)).toBe(true);
    expect(bodySystemGroups({ ...view, facts: [] }).every((g) => g.count === 0)).toBe(true);
  });
  it("counts a fact once per source, including shared source references", () => {
    const counts = sourceCounts(view);
    expect(counts).toHaveLength(5);
    expect(counts.reduce((n, s) => n + s.count, 0)).toBe(77);
    const fact = view.facts[0];
    if (!fact) throw new Error("Missing fact fixture");
    const duplicate = {
      ...fact,
      provenance: {
        ...fact.provenance,
        sources: [...fact.provenance.sources, ...fact.provenance.sources],
      },
    };
    expect(sourceCounts({ ...view, facts: [duplicate] }).reduce((n, s) => n + s.count, 0)).toBe(1);
  });
  it("combines belief, kind and case-insensitive text filters without mutating the view", () => {
    expect(
      filterFacts(view, { beliefs: ["might"], kinds: ["condition"], text: " SLEEP " }).map(
        (f) => f.label,
      ),
    ).toEqual(["Possible sleep apnoea"]);
    expect(filterFacts(view, { beliefs: ["mentioned"], kinds: ["medication"] })).toEqual([]);
    expect(filterFacts(view, { kinds: ["note", "document"] })).toHaveLength(10);
    expect(filterFacts(view, { text: "fictional-claude-model" }).length).toBeGreaterThan(0);
    expect(filterFacts(view, {})).toHaveLength(77);
    expect(filterFacts(view, { beliefs: [], kinds: [], text: "missing phrase" })).toEqual([]);
  });
  it("places partial dates at their period start and refuses impossible chart coordinates", () => {
    expect(timelineCoordinate("2025")).toBe(Date.parse("2025-01-01T00:00:00Z"));
    expect(timelineCoordinate("2025-03")).toBe(Date.parse("2025-03-01T00:00:00Z"));
    expect(timelineCoordinate("2025-02-30")).toBeUndefined();
    expect(timelineCoordinate("unknown")).toBeUndefined();
    expect(timelineCoordinate()).toBeUndefined();
  });
  it("formats UTC dates in en-GB words without inventing partial precision", () => {
    expect(formatKnowledgeDate("2025-03-03")).toBe("3 Mar 2025");
    expect(formatKnowledgeDate("2025-03-03T23:30:00-03:00")).toBe("4 Mar 2025");
    expect(formatKnowledgeDate("2025-07-03T00:30:00")).toBe("3 Jul 2025");
    expect(formatKnowledgeDate("2025-03")).toBe("Mar 2025");
    expect(formatKnowledgeDate("2025")).toBe("2025");
    expect(formatKnowledgeDate("2025-02-30")).toBe("2025-02-30");
    expect(formatKnowledgeDate("unknown")).toBe("unknown");
    expect(formatKnowledgeDate()).toBe("Not recorded");
  });
});

it("loads the fictional demo from an in-memory nanopub store", async () => {
  const { store, owner, value } = await createKnowledgeDemo();
  const original = projectHealthFacts(await store.list(), { owner });
  expect(original.facts).toHaveLength(77);
  expect(original.sources).toHaveLength(5);
  expect(projectHealthFacts(value, { owner })).toEqual(original);
});
