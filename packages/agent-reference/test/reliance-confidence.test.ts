// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { expect, it } from "vitest";
import { EvidenceItemNode } from "../src/model/evidence-item.js";
import { ConfidenceStatementNode, DQV } from "../src/model/reliance-confidence.js";
import { testKey } from "../src/reference/keys.js";
import { signClaim } from "../src/scenarios/common.js";
import { confidenceFitness } from "../src/suites/reliance-confidence.js";

const metric = "urn:metric:confidence";
const method = "urn:method:reconciliation";
const payload = {
  id: "urn:statement:balance",
  issuer: "urn:fictional:bank",
  claimType: "deposit.balance",
  method: "recorded-by-authority",
  qualityMeasurement: {
    type: "http://www.w3.org/ns/dqv#QualityMeasurement" as const,
    metric,
    method,
    value: 0.99,
    uncertainty: "epistemic" as const,
    calibration: "calibrated" as const,
    observations: { correct: 99, total: 100 },
  },
};
const settings = {
  receivers: [],
  rules: [{ claimType: "deposit.balance", minimum: 0.95, metric, methods: [method] }],
};

it("keeps source-signed confidence through evidence forwarding and exposes a native DQV measurement on the statement", async () => {
  const key = await testKey("confidence-bank");
  const jws = await signClaim(key, payload);
  const evidence = EvidenceItemNode.toNode({
    role: "credential",
    format: "jws-compact",
    value: jws,
  });
  expect(
    await evidence.credential?.verifyOriginal({
      typ: "awp-statement+jws",
      resolve: (kid) => (kid === key.kid ? key : undefined),
    }),
  ).toBe(true);
  expect(evidence.toObject().value).toBe(jws);
  const statement = ConfidenceStatementNode.fromSignedPayload(evidence.credential?.payload);
  const measurement = statement.measurement;
  expect(measurement?.types.has(DQV + "QualityMeasurement")).toBe(true);
  expect(measurement?.computedOn).toBe(payload.id);
  expect(measurement?.source).toBe(payload.issuer);
  expect(measurement?.score).toBe(0.99);
  expect(measurement?.method).toBe(method);
  expect(measurement?.uncertainty).toBe("epistemic");
  expect(measurement?.calibration).toBe("calibrated");
  expect(confidenceFitness(evidence.credential?.payload, settings).ok).toBe(true);
});

it("never turns a missing method, model self-estimate, false calibration or wrong metric into sufficient confidence", () => {
  const uncalibrated = {
    ...payload.qualityMeasurement,
    method: undefined,
    observations: undefined,
  };
  const view = ConfidenceStatementNode.fromSignedPayload({
    ...payload,
    method: "model-output",
    qualityMeasurement: uncalibrated,
  });
  expect(view.measurement?.calibration).toBe("uncalibrated");
  for (const qualityMeasurement of [
    uncalibrated,
    { ...payload.qualityMeasurement, value: 0.94, observations: { correct: 94, total: 100 } },
    { ...payload.qualityMeasurement, observations: { correct: 100, total: 100 } },
    { ...payload.qualityMeasurement, metric: "urn:metric:other" },
    { ...payload.qualityMeasurement, method: "urn:method:not-accepted" },
    { ...payload.qualityMeasurement, value: 1.01 },
    { ...payload.qualityMeasurement, value: Number.NaN },
  ])
    expect(confidenceFitness({ ...payload, qualityMeasurement }, settings)).toMatchObject({
      ok: false,
      reason: "confidence-too-low",
    });
});

it("preserves probability boundaries and small values as valid decimal RDF literals", () => {
  for (const value of [0, 1, 1e-7, Number.MIN_VALUE]) {
    const statement = ConfidenceStatementNode.fromSignedPayload({
      ...payload,
      qualityMeasurement: { ...payload.qualityMeasurement, value },
    });
    const measurement = statement.measurement;
    expect(measurement?.score).toBe(value);
    const literal = [...statement.dataset].find(
      (quad) => quad.predicate.value === DQV + "value",
    )?.object;
    expect(literal?.termType).toBe("Literal");
    expect(literal?.value).toMatch(/^\d+(?:\.\d+)?$/);
  }
});

it("defines the local DQV annotations without changing the message lane's pinned ontology", async () => {
  const ontology = await parseRdf(
    readFileSync(new URL("../vocab/meaning-reliance.ttl", import.meta.url), "utf8"),
    "text/turtle",
  );
  const statement = ConfidenceStatementNode.fromSignedPayload(payload);
  for (const quad of statement.dataset) {
    if (!quad.predicate.value.startsWith("https://w3id.org/jeswr/awp#")) continue;
    if (quad.predicate.value.endsWith("claimType")) continue; // Defined by the main ontology.
    for (const name of ["label", "comment", "domain", "range"])
      expect(
        [...ontology].filter(
          (definition) =>
            definition.subject.value === quad.predicate.value &&
            definition.predicate.value === "http://www.w3.org/2000/01/rdf-schema#" + name,
        ),
      ).toHaveLength(1);
  }
});
