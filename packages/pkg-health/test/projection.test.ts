// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import {
  createFactAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import type { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { entities } from "../src/generated/model.js";
import { HEALTH_CATEGORIES, HealthGraphError, projectHealthFacts } from "../src/index.js";
import { batch, claim, condition, FixtureNode, H, medication, other, owner, X } from "./helpers.js";

describe("projection and ownership", () => {
  it("keeps all belief/validity levels, revisions, contradictions, hedges and corroboration", async () => {
    const value = await batch([
      claim("definite"),
      { ...claim("duplicate"), epistemic: "Documented" },
      {
        ...claim("hedged", condition("Possibly fictional", "hedged")),
        epistemic: "SelfReportedHedged",
        hedge: "possibly",
      },
      {
        ...claim("mentioned", condition("Mentioned fictional", "mentioned")),
        epistemic: "Mentioned",
      },
      { ...claim("old", condition("Earlier fictional", "old")), validity: "Superseded" },
      {
        ...claim("retracted", condition("Withdrawn fictional", "retracted")),
        validity: "Retracted",
      },
      {
        ...claim("historical", condition("Historical fictional", "historical")),
        validity: "Historical",
      },
      {
        ...claim("conflict", condition("Conflicting fictional", "conflict")),
        validity: "Contradicted",
        contradicts: ["definite"],
      },
      { ...claim("revision", condition("Revised fictional", "revision")), supersedes: ["old"] },
    ]);
    const before = await serializeNanopublications(value);
    const view = projectHealthFacts(value, { owner });
    const byLabel = (label: string) => view.facts.find((f) => f.label === label);
    expect(view.facts).toHaveLength(9);
    expect(byLabel("Possibly fictional")).toMatchObject({ belief: "might", hedge: "possibly" });
    expect(byLabel("Mentioned fictional")?.belief).toBe("mentioned");
    expect(view.facts.filter((f) => f.belief === "past")).toHaveLength(3);
    const duplicates = view.facts.filter((f) => f.label === "Fictional condition");
    expect(duplicates.map((f) => f.corroboration)).toEqual([2, 2]);
    expect(duplicates.find((f) => f.epistemic === "Documented")?.belief).toBe("definitely");
    expect(duplicates.find((f) => f.epistemic === "SelfReportedExplicit")?.belief).toBe("might");
    expect(byLabel("Earlier fictional")?.replacedBy).toEqual([byLabel("Revised fictional")?.id]);
    expect(await serializeNanopublications(value)).toBe(before);
  });
  it("excludes foreign subjects even with health categories or conflicting owner aliases", async () => {
    const foreign = createFactAssertion(other, condition("Private foreign", "other"));
    const mixed = createFactAssertion(owner, condition("Ambiguous subject", "mixed"));
    new FixtureNode("https://example.org/entities/mixed", mixed).link(
      "http://hl7.org/fhir/subject",
      other,
    );
    const value = await batch([
      { ...claim("foreign"), assertion: foreign },
      { ...claim("mixed"), assertion: mixed },
      { ...claim("typed"), categories: [] },
      {
        ...claim("email"),
        assertion: createFactAssertion(owner, { template: "email", value: "avery@example.org" }),
        categories: ["pd:EmailAddress"],
      },
      {
        ...claim("ignored"),
        assertion: entities.MedicinalProduct.build("https://example.org/entities/ignored", {
          name: "Unrelated product",
        }),
        categories: ["pd:Preference"],
      },
    ]);
    const view = projectHealthFacts(value, { owner });
    expect(view.facts).toHaveLength(1);
    expect(view.unrecognised).toEqual([]);
    expect(view.excludedOtherSubjects).toBe(2);
    expect(JSON.stringify(view)).not.toContain("Private foreign");
    expect(JSON.stringify(view)).not.toContain("Ambiguous subject");
  });
  it("retains category-only health claims and labels, without importing foreign fallbacks", async () => {
    const unrecognised = entities.MedicinalProduct.build("https://example.org/entities/unknown", {
      name: "Fictional product only",
    });
    const foreign = entities.MedicinalProduct.build(
      "https://example.org/entities/foreign-product",
      { name: "Hidden product" },
    );
    new FixtureNode("https://example.org/entities/foreign-product", foreign).link(
      `${H}patient`,
      other,
    );
    const unknown = entities.MedicinalProduct.build("https://example.org/entities/no-name", {});
    new FixtureNode("https://example.org/entities/no-name", unknown).text(
      "http://www.w3.org/2000/01/rdf-schema#label",
      "Fictional label",
    );
    const view = projectHealthFacts(
      await batch([
        { ...claim("unknown"), assertion: unrecognised, categories: ["pd:MentalHealth"] },
        { ...claim("foreign"), assertion: foreign },
        { ...claim("label"), assertion: unknown },
      ]),
      { owner },
    );
    expect(view.facts).toEqual([]);
    expect(view.unrecognised.map((f) => f.label).sort()).toEqual([
      "Fictional label",
      "Fictional product only",
    ]);
    expect(view.excludedOtherSubjects).toBe(1);
    expect(HEALTH_CATEGORIES).toContain("https://w3id.org/dpv/pd#Prescription");
    expect(HEALTH_CATEGORIES).not.toContain("https://w3id.org/dpv/pd#PoliticalOpinion");
  });
  it("isolates assertion graphs, includes owner facts in mixed assertions and counts a foreign nanopub once", async () => {
    const graph = createFactAssertion(owner, condition());
    graph.addQuads([
      ...createFactAssertion(other, condition("Foreign", "foreign")),
      ...createFactAssertion(other, condition("Another foreign", "foreign-two")),
    ]);
    const view = projectHealthFacts(await batch([{ ...claim("mixed"), assertion: graph }]), {
      owner,
    });
    expect(view.facts.map((f) => f.label)).toEqual(["Fictional condition"]);
    expect(view.excludedOtherSubjects).toBe(1);
    expect(view.unrecognised).toEqual([]);
  });
  it("reads canonical and legacy condition/code aliases without changing hashes or lexical data", async () => {
    const value = await parseNanopublications(
      readFileSync(new URL("fixtures/legacy.trig", import.meta.url), "utf8"),
    );
    const snapshot = await serializeNanopublications(value);
    const view = projectHealthFacts(value, { owner });
    expect(view.facts).toHaveLength(1);
    expect(view.facts[0]).toMatchObject({
      subject: "https://example.org/entities/legacy-condition",
      kind: "condition",
      label: "Fictional legacy asthma",
      code: { value: "195967001", system: "snomed" },
      period: { start: "2021-02", startTime: Date.parse("2021-02-01T00:00:00Z") },
    });
    expect(await serializeNanopublications(value)).toBe(snapshot);
  });
  it("reads allergy, medication product, exact decimal dose and ATC blank-node records", async () => {
    const view = projectHealthFacts(
      await batch([
        claim("allergy", {
          template: "allergy",
          value: { id: "https://example.org/entities/allergy", name: "Fictional pollen" },
        }),
        claim("medication", medication()),
      ]),
      { owner },
    );
    expect(view.byKind.allergy[0]).toMatchObject({
      kind: "allergy",
      substance: "Fictional pollen",
    });
    expect(view.byKind.medication[0]).toMatchObject({
      label: "Fictionalium",
      product: { name: "Fictionalium", atcCode: "C01AA00" },
      dose: { value: "2.00", unit: "mg", frequency: "daily" },
      code: { value: "C01AA00", system: "atc" },
    });
  });
  it("reads immunizations, encounters, OWL-Time dates and recordedBy", async () => {
    const vaccine = entities.Immunization.build("https://example.org/entities/vaccination", {
      patient: owner,
      medication: "https://example.org/entities/vaccine",
      name: "Fictional vaccination",
    });
    vaccine.addQuads([
      ...entities.MedicinalProduct.build("https://example.org/entities/vaccine", {
        name: "Fictional vaccine",
      }),
    ]);
    new FixtureNode("https://example.org/entities/vaccination", vaccine).text(
      `${H}effectiveTime`,
      "2025-03-04",
      `${X}date`,
    );
    const encounter = entities.Encounter.build("https://example.org/entities/encounter", {
      patient: owner,
      name: "Fictional visit",
      recordedBy: other,
    });
    new FixtureNode("https://example.org/entities/encounter", encounter).link(
      `${H}effectiveTime`,
      "https://example.org/time/interval",
    );
    new FixtureNode("https://example.org/time/interval", encounter).link(
      "http://www.w3.org/2006/time#hasBeginning",
      "https://example.org/time/start",
    );
    new FixtureNode("https://example.org/time/start", encounter).text(
      "http://www.w3.org/2006/time#inXSDDateTime",
      "2025-04-01T11:00:00Z",
      `${X}dateTime`,
    );
    const view = projectHealthFacts(
      await batch([
        { ...claim("vaccine"), assertion: vaccine },
        { ...claim("encounter"), assertion: encounter },
      ]),
      { owner },
    );
    expect(view.byKind.immunization[0]).toMatchObject({
      product: "Fictional vaccine",
      date: "2025-03-04",
    });
    expect(view.byKind.encounter[0]).toMatchObject({
      date: "2025-04-01T11:00:00+00:00",
      recordedBy: other,
    });
  });
  it("projects graph-scoped source metadata and message evidence", async () => {
    const value = await batch([
      {
        ...claim("with-evidence"),
        evidence: [
          {
            source: "chat",
            message_id: "example-message",
            quote: "My fictional condition is recorded.",
            timestamp: "2026-11-01T10:01:00Z",
            speaker: "me",
          },
        ],
      },
      claim("without-evidence"),
    ]);
    const view = projectHealthFacts(value, { owner });
    const withEvidence = view.facts.find((f) => f.provenance.evidence.length);
    expect(withEvidence?.provenance).toMatchObject({
      generatedAt: "2026-11-10T12:00:00+00:00",
      batch: "health-test",
      agent: { iri: "https://example.org/agents/client", label: "Fictional extractor" },
      attributedTo: [owner],
      sources: [
        {
          kind: "codex-thread",
          title: "Fictional health discussion",
          model: "fictional-model",
          threadId: "12345678-1234-4234-8234-123456789abc",
          created: "2026-11-01T10:00:00+00:00",
        },
      ],
      evidence: [
        {
          quote: "My fictional condition is recorded.",
          timestamp: "2026-11-01T10:01:00+00:00",
          speaker: owner,
        },
      ],
    });
    expect(view.facts.find((f) => !f.provenance.evidence.length)?.provenance.sources).toEqual([]);
    expect(view.sources).toHaveLength(1);
  });
  it("never logs or exposes private diagnostics in projection errors", async () => {
    const value = await batch([claim("one")]);
    const log = vi.spyOn(console, "log");
    expect(() => projectHealthFacts(value, { owner: "secret private text" })).toThrow(
      HealthGraphError,
    );
    expect(() =>
      projectHealthFacts(
        {
          get dataset(): Awaited<ReturnType<typeof batch>>["dataset"] {
            throw new Error("secret private text");
          },
          nanopubs: value.nanopubs,
        },
        { owner },
      ),
    ).toThrow("read-failed");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

// AUTHORED-BY Claude Opus 5.5
it("keeps an owned fact whose schema:about names a topic, and refuses a foreign schema:patient", async () => {
  const topical = claim("topical", condition("Fictional topical condition", "topical"));
  new FixtureNode("https://example.org/entities/topical", topical.assertion as Store).link(
    "https://schema.org/about",
    "https://example.org/topics/iron",
  );
  const foreign = claim("foreign", condition("Fictional foreign condition", "foreign"));
  new FixtureNode("https://example.org/entities/foreign", foreign.assertion as Store).link(
    "http://schema.org/patient",
    other,
  );
  const view = projectHealthFacts(await batch([topical, foreign]), { owner });
  expect(view.facts.map((f) => f.label)).toEqual(["Fictional topical condition"]);
  expect(view.excludedOtherSubjects).toBe(1);
});
