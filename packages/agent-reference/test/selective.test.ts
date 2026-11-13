// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import {
  issueSelectiveCredential,
  presentSelective,
  unverifiedEvidenceClaim,
  verifySelectivePresentation,
} from "../src/mechanisms/selective.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";

const root = join(import.meta.dirname, "..");
it("runs ordinary right-to-work disclosure and passport refusal, leaving the hidden-date predicate blocked", async () => {
  const { profile, scenario } = loadCase(root, "right-to-work");
  const paths = await runScenario(profile, scenario);
  expect(paths[0]?.matches).toBe(true);
  expect(paths[1]?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "excessive-scope",
  });
  expect(paths[2]?.blocked).toBe(
    "Blocked: needs a hidden date comparison, due in sparq’s next result-proof build. The current build also rejects issuer-scoped GRAPH queries.",
  );
  expect(paths[2]?.trace).toBeUndefined();
  const trace = JSON.stringify(paths[0]?.trace);
  expect(trace).not.toContain("fictional-passport-image");
  expect(trace).not.toContain("2027-06-01");
  expect(
    paths[0]?.trace?.events.filter((e) => e.agent === "employer-agent" && e.kind === "store"),
  ).toHaveLength(2);
});

it("verifies actual salted disclosures and refuses changes to value, claim type, salt, identifier, credential or issuer", async () => {
  const key = await testKey("selective/authority");
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:holder",
    sourceAuthority: [],
    keys: [
      {
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        role: "issuer",
        subject: "urn:authority",
      },
    ],
  });
  const issued = await issueSelectiveCredential(
    key,
    {
      id: "urn:credential",
      issuer: "urn:authority",
      subject: "urn:candidate",
      method: "recorded-by-authority",
      asOf: "2026-11-13T09:00:00.000Z",
    },
    [
      { id: "urn:entitlement", claimType: "work.entitled", value: true },
      { id: "urn:passport", claimType: "passport.scan", value: "private" },
    ],
  );
  const [valid] = presentSelective(issued, ["urn:entitlement"]);
  if (!valid) throw new Error("fixture");
  expect(unverifiedEvidenceClaim(valid).claimType).toBe("work.entitled");
  expect(
    (await verifySelectivePresentation(valid, trust, "2026-11-13T09:00:00.000Z", "urn:employer"))
      .verification.outcome,
  ).toBe("valid");
  expect(valid.value).not.toContain("private");
  for (const attack of ["value", "claimType", "salt", "id", "credential"]) {
    const presentation = JSON.parse(valid.value);
    if (attack === "value") presentation.disclosure.claim.value = false;
    if (attack === "claimType") presentation.disclosure.claim.claimType = "passport.scan";
    if (attack === "salt") presentation.disclosure.salt = "x".repeat(43);
    if (attack === "id") presentation.disclosure.claim.id = "urn:another-person";
    if (attack === "credential")
      presentation.credential = `${presentation.credential.slice(0, -8)}aaaaaaaa`;
    const checked = await verifySelectivePresentation(
      { ...valid, value: JSON.stringify(presentation) },
      trust,
      "2026-11-13T09:00:00.000Z",
      "urn:employer",
    );
    expect(checked.payload, attack).toBeUndefined();
    expect(checked.verification.outcome, attack).toBe("invalid");
  }
  expect(() => presentSelective(issued, ["urn:missing"])).toThrow("unknown");
  expect(() => presentSelective(issued, ["urn:entitlement", "urn:entitlement"])).toThrow(
    "duplicate",
  );
  const again = await issueSelectiveCredential(
    key,
    {
      id: "urn:credential",
      issuer: "urn:authority",
      subject: "urn:candidate",
      method: "recorded-by-authority",
      asOf: "2026-11-13T09:00:00.000Z",
    },
    [{ id: "urn:entitlement", claimType: "work.entitled", value: true }],
  );
  expect(again.disclosures[0]?.salt).not.toBe(issued.disclosures[0]?.salt);
});
