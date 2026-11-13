// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import type { Agreement } from "./core/types.js";
import {
  ASSET,
  consumerGrant,
  DATASET_READ_OP,
  DiagnosticReaderHandler,
  EQUIPMENT_HEALTH,
  NordWerkDatasetHandler,
  OFFER_ID,
  type OfferTerms,
} from "./domains/industrial.js";
import {
  PURPOSE_STORE_RELEASE_CONDITION,
  PurposeBoundStore,
  purposeStoreReleaseCheck,
} from "./domains/purpose-store.js";
import {
  contractingMandate,
  diagnosticMandate,
  NORDWERK,
  NW_CONTRACT,
  NW_DIAG,
  nordwerkInternalRoles,
  ORBIS,
} from "./fixtures/industrial.js";
import { CONFIG_ED25519 } from "./profile/configurations.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { wireDigest } from "./runtime/transmission.js";
import { Cast } from "./scenarios/common.js";
import { runIndustrial } from "./scenarios/industrial.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-05 industrial purpose / contract / transfer separation", () => {
  it("keeps eligibility, delegation, agreement, transfer, recommendation and performance separate", async () => {
    const { obs } = await runIndustrial(fixedClock("2026-10-05T09:00:00Z"));
    expect(obs.authorisationForUnlistedRecipient).toEqual({
      phase: "refused",
      reason: "not-authorised",
    });
    expect(obs.authorisationForNordWerk).toEqual({
      phase: "completed",
      reason: "delivered",
      issued: true,
    });
    expect(obs.withoutCredential).toEqual({
      phase: "unsupported",
      reason: "unsupported-operation",
    });
    expect(obs.contractByDiagnosticAgent).toEqual({
      phase: "refused",
      reason: "representation-out-of-scope",
    });
    expect(obs.purposeMismatch).toEqual({ phase: "refused", reason: "purpose-not-permitted" });
    expect(obs.transferBeforeAgreement).toEqual({
      initiator: "no-agreement",
      holderReply: "refuse",
      holderReason: "no-agreement",
      transfersPerformed: 0,
    });
    expect(obs.agreement).toMatchObject({ phase: "agreed", sameOnBothSides: true });
    expect(obs.afterFailedTransfer).toEqual({ phase: "agreed", reason: undefined, delivered: 0 });
    expect(obs.transfer).toEqual({
      attempts: ["not-executed", "delivered"],
      consumerPhase: "completed",
      holderPhase: "completed",
      duplicate: "duplicate",
      sourceAuthority: "accepted",
    });
    expect(obs.usage).toEqual({
      diagnosticRead: "permit",
      productDevelopmentRead: "deny",
      redistribution: "deny",
    });
    expect(obs.diagnosis).toMatchObject({ risk: "high" });
    expect(obs.recommendation).toEqual({
      alpinePhase: "completed",
      nordwerkPhase: "completed",
      workOrder: "open",
    });
    expect(obs.performance).toBe("completed-synthetic");
    expect(obs.ledgers).toBe(true);
  });
});

it("releases an installed store handle and withholds a queued copy when its grant expires", async () => {
  const clock = fixedClock("2026-10-05T09:00:00Z");
  const cast = new Cast(clock.now);
  const contract = await cast.add(NW_CONTRACT, contractingMandate(), [DATASET_READ_OP.id]);
  await cast.add(NW_DIAG, diagnosticMandate(), [DATASET_READ_OP.id], {
    ownerKey: contract.ownerKey,
  });
  cast.introduce(NW_CONTRACT.name, NW_DIAG.name);
  const store = new PurposeBoundStore(NORDWERK, nordwerkInternalRoles(), clock.now);
  const terms: OfferTerms = {
    model: EQUIPMENT_HEALTH.id,
    modelVersion: EQUIPMENT_HEALTH.version,
    offerId: OFFER_ID,
    asset: ASSET,
    window: { start: clock.now().toISOString(), end: clock.now().toISOString() },
    purpose: PURPOSE.maintenance,
    recipient: NORDWERK,
    retentionDays: 1,
    noRedistribution: true,
    thirdPartyAuthorisation: "urn:test:existing-authorisation",
    synthetic: true,
  };
  const grant = consumerGrant(
    { id: "urn:test:existing-agreement" } as Agreement,
    terms,
    ORBIS,
    NORDWERK,
  );
  const dataset = "urn:test:existing-dataset";
  store.put({
    id: dataset,
    claimType: "telemetry.vibration-temperature",
    subject: ASSET,
    source: ORBIS,
    data: { samples: [{ t: clock.now().toISOString(), vibrationRms: 4.2, temperatureC: 61 }] },
    grant: {
      id: grant.policy.id as string,
      target: grant.target,
      policy: grant.policy,
      assignee: NORDWERK,
      validUntil: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    },
  });
  const { runtime: provider } = await cast.runtime(
    NW_CONTRACT.name,
    [new NordWerkDatasetHandler({ organisation: NORDWERK, store })],
    [],
    [CONFIG_ED25519],
    { disclosureChecks: { [PURPOSE_STORE_RELEASE_CONDITION]: purposeStoreReleaseCheck(store) } },
  );
  const { runtime: reader } = await cast.runtime(NW_DIAG.name, [new DiagnosticReaderHandler()]);
  reader.instruct("Inspect the principal-selected dataset.", { dataset });
  const queue = async () => {
    const request = await reader.startInvocation({
      peer: { actor: NW_CONTRACT.actor, party: NORDWERK },
      operation: DATASET_READ_OP,
      input: { dataset, purpose: PURPOSE.maintenance },
      basis: { kind: "represented" },
      purpose: PURPOSE.maintenance,
      models: [EQUIPMENT_HEALTH],
      discover: false,
      configuration: CONFIG_ED25519,
    });
    expect(request.outbound).toHaveLength(1);
    const response = await provider.receive(request.outbound[0]?.wire);
    expect(response.outbound).toHaveLength(1);
    const message = response.outbound[0];
    if (!message) throw new Error("no protected delivery");
    expect(message.kind).toBe("deliver");
    return message;
  };
  const send = vi.fn(async () => ({ outcome: "accepted" as const, providerRef: "local-1" }));
  const first = await queue();
  expect(
    await provider.transmit(
      {
        messageId: first.id,
        binding: "direct-local/0.1",
        externalId: first.id,
        wireDigest: wireDigest(first.wire),
      },
      { send },
    ),
  ).toMatchObject({ status: "sent" });
  expect((await reader.receive(first.wire)).disposition).toBe("accepted");
  const held = await queue();
  clock.advance(2 * 3_600_000);
  expect(
    await provider.transmit(
      {
        messageId: held.id,
        binding: "direct-local/0.1",
        externalId: held.id,
        wireDigest: wireDigest(held.wire),
      },
      { send },
    ),
  ).toMatchObject({ status: "refused", reason: "condition-failed" });
  expect(send).toHaveBeenCalledTimes(1);
});
