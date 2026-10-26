/**
 * UC-05 executable workflow: Alpine (user: planner + data-authority agent), Orbis (data
 * holder: telemetry provider) and NordWerk (recipient: contracting + diagnostic agents).
 */

import { DirectBus } from "../bindings/direct.js";
import { newUrn } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import {
  AlpineAuthorityHandler,
  AlpinePlannerHandler,
  ASSET,
  DATA_OFFER_OP,
  diagnose,
  EQUIPMENT_HEALTH,
  INTERNAL_TPA_OP,
  NordWerkContractHandler,
  NordWerkDiagnosticHandler,
  OFFER_ID,
  type OfferTerms,
  OrbisProviderHandler,
  RECOMMENDATION_MODEL,
  RECOMMENDATION_OP,
  REQUEST_MODEL,
  SyntheticWorkOrders,
  syntheticTelemetry,
  type TelemetrySample,
  TRANSFER_OP,
} from "../domains/industrial.js";
import { PurposeBoundStore } from "../domains/purpose-store.js";
import {
  ALPINE,
  ALPINE_ISSUER,
  AUTHORITY,
  authorityMandate,
  CHEAPFIX,
  contractingMandate,
  diagnosticMandate,
  NORDWERK,
  NW_CONTRACT,
  NW_DIAG,
  NW_PRODUCT,
  nordwerkInternalRoles,
  ORBIS,
  ORBIS_TP,
  PLANNER,
  PROGRAMME,
  plannerMandate,
  providerMandate,
  providerSourceRules,
  recipientSourceRules,
} from "../fixtures/industrial.js";
import { generateSigningKey } from "../mechanisms/jws.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import { PILOT_PROFILE, PURPOSE } from "../profile/vocabulary.js";
import { verifyLedger } from "../store/ledger.js";
import type { WireMessage } from "../store/state.js";
import { Cast, craftSigned } from "./common.js";
import { scenarioPolicyEngine } from "./policy.js";

export { AUTHORITY, NW_CONTRACT, NW_DIAG, ORBIS_TP, PLANNER } from "../fixtures/industrial.js";

export async function runIndustrial(clock: { now: () => Date; advance: (ms: number) => void }) {
  const now = clock.now;
  const cast = new Cast(now);
  const alpineOrg = (await generateSigningKey("EdDSA")).key;
  const nordwerkOrg = (await generateSigningKey("EdDSA")).key;
  const programmeKey = (await generateSigningKey("EdDSA")).key;
  const alpineIssuer = (await generateSigningKey("EdDSA")).key;

  await cast.add(PLANNER, plannerMandate(), [INTERNAL_TPA_OP.id, RECOMMENDATION_OP.id], {
    ownerKey: alpineOrg,
  });
  await cast.add(AUTHORITY, authorityMandate(), [INTERNAL_TPA_OP.id], { ownerKey: alpineOrg });
  await cast.add(ORBIS_TP, providerMandate(), [DATA_OFFER_OP.id, TRANSFER_OP.id]);
  await cast.add(NW_CONTRACT, contractingMandate(), [DATA_OFFER_OP.id, TRANSFER_OP.id], {
    ownerKey: nordwerkOrg,
  });
  // The diagnostic agent's LOCAL mandate is deliberately over-broad (it lists contracting);
  // NordWerk's org-signed representation scope does not — the counterparty checks that.
  await cast.add(NW_DIAG, diagnosticMandate(), [RECOMMENDATION_OP.id], { ownerKey: nordwerkOrg });
  cast.introduce("alpine-planner", "alpine-authority");
  cast.introduce("nordwerk-contracting", "orbis-telemetry");
  cast.introduce("nordwerk-diagnostic", "orbis-telemetry");
  cast.introduce("nordwerk-diagnostic", "alpine-planner");
  cast.pinIssuer("orbis-telemetry", PROGRAMME, programmeKey, "synthetic programme test issuer");
  cast.pinIssuer(
    "orbis-telemetry",
    ALPINE_ISSUER,
    alpineIssuer,
    "Alpine data-authority issuing key",
  );
  const until = new Date(now().getTime() + 365 * 86_400_000).toISOString();
  for (const rule of providerSourceRules(until)) cast.rule("orbis-telemetry", rule);
  for (const rule of recipientSourceRules(until)) cast.rule("nordwerk-contracting", rule);

  const membership = await signStatement(programmeKey, TYP.statement, {
    type: "ParticipantCredential",
    id: newUrn(),
    issuer: PROGRAMME,
    subject: NORDWERK,
    programme: "synthetic dataspace test programme",
    issuedAt: now().toISOString(),
    validUntil: until,
  });
  const shared = {
    agreements: new Map<string, OfferTerms>(),
    delivered: new Map<string, string>(),
  };
  const telemetry = () => syntheticTelemetry(new Date(now().getTime() - 3_600_000));
  const orbisOffer = new OrbisProviderHandler(DATA_OFFER_OP, {
    holder: ORBIS,
    programmeIssuer: PROGRAMME,
    userIssuer: ALPINE_ISSUER,
    telemetry,
    shared,
  });
  const orbisTransfer = new OrbisProviderHandler(TRANSFER_OP, {
    holder: ORBIS,
    programmeIssuer: PROGRAMME,
    userIssuer: ALPINE_ISSUER,
    telemetry,
    shared,
  });
  const nwStore = new PurposeBoundStore(
    NORDWERK,
    nordwerkInternalRoles(),
    now,
    scenarioPolicyEngine(),
  );
  const nwOffer = new NordWerkContractHandler(DATA_OFFER_OP, {
    holder: ORBIS,
    recipient: NORDWERK,
    store: nwStore,
    acceptedModels: [EQUIPMENT_HEALTH],
  });
  const nwTransfer = new NordWerkContractHandler(TRANSFER_OP, {
    holder: ORBIS,
    recipient: NORDWERK,
    store: nwStore,
    acceptedModels: [EQUIPMENT_HEALTH],
  });
  const plannerTpa = new AlpinePlannerHandler(INTERNAL_TPA_OP);
  const workOrders = new SyntheticWorkOrders();
  const planner = await cast.runtime(
    "alpine-planner",
    [plannerTpa, new AlpinePlannerHandler(RECOMMENDATION_OP)],
    [workOrders],
  );
  const authority = await cast.runtime("alpine-authority", [
    new AlpineAuthorityHandler({ user: ALPINE, issuer: ALPINE_ISSUER, issuerKey: alpineIssuer }),
  ]);
  const orbis = await cast.runtime("orbis-telemetry", [orbisOffer, orbisTransfer]);
  const nw = await cast.runtime("nordwerk-contracting", [nwOffer, nwTransfer]);
  const diag = await cast.runtime("nordwerk-diagnostic", [
    new NordWerkDiagnosticHandler(),
    new NordWerkContractHandler(DATA_OFFER_OP, {
      holder: ORBIS,
      recipient: NORDWERK,
      store: nwStore,
      acceptedModels: [EQUIPMENT_HEALTH],
    }),
  ]);
  const bus = new DirectBus().register(
    planner.runtime,
    authority.runtime,
    orbis.runtime,
    nw.runtime,
    diag.runtime,
  );
  const obs: Record<string, unknown> = {};
  const phase = (rt: typeof nw.runtime, id: string | undefined) => {
    const c = rt.conversation(id ?? "");
    return { phase: c?.phase, reason: c?.closedReason };
  };
  const win = {
    start: new Date(now().getTime() - 72 * 3_600_000).toISOString(),
    end: now().toISOString(),
  };

  // 1. Internal delegation at Alpine: the authority agent's mandate bounds recipients.
  const request = (recipient: string) => ({
    model: REQUEST_MODEL.id,
    asset: ASSET,
    dataHolder: ORBIS,
    recipient,
    window: win,
    purpose: PURPOSE.maintenance,
    retentionDays: 30,
  });
  const cheap = await planner.runtime.startInvocation({
    peer: { actor: AUTHORITY.actor, party: ALPINE },
    operation: INTERNAL_TPA_OP,
    input: request(CHEAPFIX),
    basis: { kind: "represented" },
    models: [REQUEST_MODEL],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  bus.send(planner.runtime, cheap);
  await bus.run();
  obs.authorisationForUnlistedRecipient = phase(planner.runtime, cheap.conversation);
  const ok = await planner.runtime.startInvocation({
    peer: { actor: AUTHORITY.actor, party: ALPINE },
    operation: INTERNAL_TPA_OP,
    input: request(NORDWERK),
    basis: { kind: "represented" },
    models: [REQUEST_MODEL],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  bus.send(planner.runtime, ok);
  await bus.run();
  obs.authorisationForNordWerk = {
    ...phase(planner.runtime, ok.conversation),
    issued: Boolean(plannerTpa.authorisation),
  };
  const tpa = plannerTpa.authorisation as string;
  const tpaId = JSON.parse(Buffer.from(tpa.split(".")[1] ?? "", "base64url").toString("utf8"))
    .id as string;
  // (hand-over of the authorisation from Alpine to NordWerk happens out of band in this pilot)

  const terms = (purpose: string): JsonObject => ({
    model: EQUIPMENT_HEALTH.id,
    modelVersion: EQUIPMENT_HEALTH.version,
    offerId: OFFER_ID,
    asset: ASSET,
    window: win,
    purpose,
    recipient: NORDWERK,
    retentionDays: 30,
    noRedistribution: true,
    thirdPartyAuthorisation: tpaId,
    synthetic: true,
  });
  const evidence = [
    { role: "membership" as const, format: "jws-compact", value: membership },
    { role: "authorisation" as const, format: "jws-compact", value: tpa },
  ];

  // 2. Catalogue is restricted: without a participant credential the offer is invisible.
  const noCred = await nw.runtime.startNegotiation({
    peer: { actor: ORBIS_TP.actor, party: ORBIS },
    operation: DATA_OFFER_OP,
    terms: terms(PURPOSE.maintenance),
    models: [EQUIPMENT_HEALTH],
  });
  bus.send(nw.runtime, noCred);
  await bus.run();
  obs.withoutCredential = phase(nw.runtime, noCred.conversation);

  // 3. Valid credential, but the diagnostic agent is not delegated to contract for NordWerk.
  const byDiag = await diag.runtime.startNegotiation({
    peer: { actor: ORBIS_TP.actor, party: ORBIS },
    operation: DATA_OFFER_OP,
    terms: terms(PURPOSE.maintenance),
    models: [EQUIPMENT_HEALTH],
    evidence,
  });
  bus.send(diag.runtime, byDiag);
  await bus.run();
  obs.contractByDiagnosticAgent = phase(diag.runtime, byDiag.conversation);

  // 4. Purpose mismatch with the user's authorisation is refused.
  const rnd = await nw.runtime.startNegotiation({
    peer: { actor: ORBIS_TP.actor, party: ORBIS },
    operation: DATA_OFFER_OP,
    terms: terms(PURPOSE.productDevelopment),
    models: [EQUIPMENT_HEALTH],
    evidence,
  });
  bus.send(nw.runtime, rnd);
  await bus.run();
  obs.purposeMismatch = phase(nw.runtime, rnd.conversation);

  // 5. Transfer before agreement: refused locally, and refused by Orbis when forced.
  const local = await nw.runtime.startInvocation({
    peer: { actor: ORBIS_TP.actor, party: ORBIS },
    operation: TRANSFER_OP,
    input: { dataset: "vibration-temperature" },
    basis: { kind: "agreement", agreement: "urn:awp:agreement:not-formed" },
    models: [EQUIPMENT_HEALTH],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  const at = now();
  const forced = await craftSigned(cast.get("nordwerk-contracting"), {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: newUrn(),
    conversation: newUrn(),
    kind: "invoke",
    from: { actor: NW_CONTRACT.actor, onBehalfOf: NORDWERK, operator: NORDWERK },
    to: { actor: ORBIS_TP.actor, party: ORBIS },
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 600_000).toISOString(),
    body: {
      operation: TRANSFER_OP,
      input: { dataset: "vibration-temperature" },
      basis: { kind: "agreement", agreement: "urn:awp:agreement:not-formed" },
    },
    evidence: [
      {
        role: "representation",
        format: "jws-compact",
        value: cast.get("nordwerk-contracting").representationJws,
      },
    ],
  });
  const forcedResult = await orbis.runtime.receive(forced);
  obs.transferBeforeAgreement = {
    initiator: local.reason,
    holderReply: forcedResult.outbound[0]?.kind,
    holderReason: forcedResult.reason,
    transfersPerformed: orbisTransfer.transfers.length,
  };

  // 6. The authorised contracting agent agrees the exact terms version.
  const good = await nw.runtime.startNegotiation({
    peer: { actor: ORBIS_TP.actor, party: ORBIS },
    operation: DATA_OFFER_OP,
    terms: terms(PURPOSE.maintenance),
    models: [EQUIPMENT_HEALTH],
    evidence,
  });
  bus.send(nw.runtime, good);
  await bus.run();
  const conv = good.conversation as string;
  const agreement = nw.runtime.agreements().find((a) => a.conversation === conv);
  obs.agreement = {
    ...phase(nw.runtime, conv),
    id: agreement?.id,
    termsDigest: agreement?.termsDigest,
    sameOnBothSides: orbis.runtime
      .agreements()
      .some((a) => a.id === agreement?.id && a.termsDigest === agreement?.termsDigest),
  };

  // 7. Transfer fails once (agreement stands, nothing delivered), then succeeds; a
  //    redelivered transfer request is a duplicate.
  orbisTransfer.failNextTransfer = true;
  const t1 = await nw.runtime.invokeUnderAgreement({
    conversation: conv,
    operation: TRANSFER_OP,
    input: { dataset: "vibration-temperature" },
    purpose: PURPOSE.maintenance,
  });
  bus.send(nw.runtime, t1);
  await bus.run();
  obs.afterFailedTransfer = {
    ...phase(nw.runtime, conv),
    delivered: nwOffer.datasets.length + nwTransfer.datasets.length,
  };
  let transferWire: WireMessage | undefined;
  const t2 = await nw.runtime.invokeUnderAgreement({
    conversation: conv,
    operation: TRANSFER_OP,
    input: { dataset: "vibration-temperature" },
    purpose: PURPOSE.maintenance,
  });
  bus.send(nw.runtime, t2);
  await bus.run(({ out }) => {
    if (out.kind === "invoke") transferWire = out.wire;
    return undefined;
  });
  const dup = transferWire ? await orbis.runtime.receive(transferWire) : undefined;
  obs.transfer = {
    attempts: orbisTransfer.transfers.map((t) => t.outcome),
    consumerPhase: phase(nw.runtime, conv).phase,
    holderPhase: phase(orbis.runtime, conv).phase,
    duplicate: dup?.disposition,
    sourceAuthority: nw.ledger.entries().find((e) => e.record.type === "source-authority")?.record
      .outcome,
  };

  // 8. Consumer-side enforcement of the agreed usage policy.
  const datasetId = nwTransfer.datasets[0]?.storedAs ?? "";
  const diagRead = nwStore.request({
    agent: NW_DIAG.actor,
    action: "read",
    items: [datasetId],
    purpose: PURPOSE.maintenance,
  });
  const productRead = nwStore.request({
    agent: NW_PRODUCT,
    action: "read",
    items: [datasetId],
    purpose: PURPOSE.productDevelopment,
  });
  const redistribute = nwStore.request({
    agent: NW_CONTRACT.actor,
    action: "distribute",
    items: [datasetId],
    purpose: PURPOSE.maintenance,
    recipient: CHEAPFIX,
  });
  obs.usage = {
    diagnosticRead: diagRead.decision,
    productDevelopmentRead: productRead.decision,
    redistribution: redistribute.decision,
  };

  // 9. Diagnosis (a modelled assertion), recommendation, acceptance, work order, performance.
  const samples = ((diagRead.items?.[0]?.data as { samples?: TelemetrySample[] })?.samples ??
    []) as TelemetrySample[];
  const d = diagnose(samples, now().toISOString());
  obs.diagnosis = d;
  if (!("stale" in d)) {
    const rec = {
      model: RECOMMENDATION_MODEL.id,
      asset: ASSET,
      assertion: {
        risk: d.risk,
        confidence: d.confidence,
        basis: [datasetId],
        limitations: d.limitations,
      },
      proposedAction: { kind: "inspect-bearing", withinDays: 7, cost: 0 },
      dataset: datasetId,
      synthetic: true,
    };
    const toAlpine = await diag.runtime.startNegotiation({
      peer: { actor: PLANNER.actor, party: ALPINE },
      operation: RECOMMENDATION_OP,
      terms: rec as unknown as JsonObject,
      models: [RECOMMENDATION_MODEL],
    });
    bus.send(diag.runtime, toAlpine);
    await bus.run();
    const order = [...workOrders.orders.values()][0];
    obs.recommendation = {
      alpinePhase: phase(planner.runtime, toAlpine.conversation).phase,
      nordwerkPhase: phase(diag.runtime, toAlpine.conversation).phase,
      workOrder: order?.status,
    };
    if (order) {
      order.status = "completed-synthetic";
      planner.runtime.recordObservation({
        type: "performance-observation",
        observedBy: "synthetic maintenance system",
        workOrder: order.id,
        status: order.status,
        note: "simulated; no real maintenance scheduled",
      });
    }
    obs.performance = order?.status;
  }
  obs.statuses = {
    eligibility: "credential verified (identifies participant only)",
    internalDelegation: {
      alpine: "authority agent issued authorisation within its mandate",
      nordwerk: "contracting agent represented; diagnostic agent not",
    },
    agreement:
      (obs.agreement as { phase?: string }).phase === "completed"
        ? "formed and performed"
        : "formed",
    transfer: orbisTransfer.transfers.map((t) => t.outcome),
    recommendation: (obs.recommendation as { alpinePhase?: string } | undefined)?.alpinePhase,
    performance: obs.performance,
  };
  obs.ledgers =
    [planner, authority, orbis, nw, diag].every((r) => verifyLedger(r.ledger.entries()).ok) &&
    verifyLedger(nwStore.auditEntries()).ok;
  obs.boundary =
    "post-transfer control covers access through NordWerk's enforcement point only; copies outside it are not controlled";
  // Runtime evidence, for consumers that analyse the ledgers (e.g. the RDF competency tests).
  const ledgers = { planner, authority, orbis, nordwerk: nw, diagnostics: diag };
  return {
    obs,
    trace: bus.trace,
    ledgers: Object.fromEntries(Object.entries(ledgers).map(([k, r]) => [k, r.ledger.entries()])),
  };
}
