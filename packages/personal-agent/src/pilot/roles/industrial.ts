/**
 * SYNTHETIC EU industrial maintenance data exchange (UC-05) as durable, independently
 * initialised agents of three organisations. Every role composes the EXISTING domain handlers
 * (`domains/industrial.ts`); the runtime (signatures, pinned keys, representation, owner
 * mandates through the policy module, replay, effects) is unchanged.
 *
 *  - `industrial-planner` (Alpine): asks Alpine's data authority for a third-party access
 *    authorisation, hands it to the recipient's operator (out of band), evaluates NordWerk's
 *    recommendation and — once ACCEPTED — creates a synthetic work order through an effect
 *    (created once, recorded in `industrial-work-orders.json`); performance is a SEPARATE,
 *    later, simulated observation.
 *  - `industrial-authority` (Alpine): issues the authorisation with its OWN issuing key, within
 *    its mandate (recipient NordWerk only).
 *  - `industrial-provider` (Orbis): restricted catalogue (participant credential), exact
 *    agreement, transfer ONLY under an agreement it holds, source/holder statements. Agreements
 *    and deliveries are durable runtime domain state.
 *  - `industrial-contracting` (NordWerk): negotiates the exact offer, requests the transfer,
 *    stores the data in NordWerk's purpose-bound store under the agreed usage policy, and serves
 *    NordWerk's INTERNAL dataset reads — the requesting agent is the verified signer.
 *  - `industrial-diagnostic` (NordWerk): reads a dataset internally, derives a modelled
 *    assertion and proposes a recommendation to the planner.
 * Agreement, transfer and performance are distinct events in distinct ledgers. Organisation
 * membership (the programme credential) establishes eligibility only, never internal authority.
 * Synthetic organisations and data; no Catena-X/DSP certification, connector or legal
 * eligibility is claimed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Iri, JsonObject, Json as JsonValue } from "../core/types.js";
import {
  AlpineAuthorityHandler,
  AlpinePlannerHandler,
  ASSET,
  DATA_OFFER_OP,
  DATASET_READ_OP,
  DiagnosticReaderHandler,
  EQUIPMENT_HEALTH,
  EQUIPMENT_HEALTH_OLD,
  INTERNAL_TPA_OP,
  NordWerkContractHandler,
  NordWerkDatasetHandler,
  NordWerkDiagnosticHandler,
  OFFER_ID,
  type OfferTerms,
  OrbisProviderHandler,
  RECOMMENDATION_MODEL,
  RECOMMENDATION_OP,
  REQUEST_MODEL,
  SyntheticWorkOrders,
  syntheticTelemetry,
  TRANSFER_OP,
  tpaSchema,
  type WorkOrder,
} from "../domains/industrial.js";
import {
  PURPOSE_STORE_RELEASE_CONDITION,
  PurposeBoundStore,
  purposeStoreReleaseCheck,
} from "../domains/purpose-store.js";
import {
  ALPINE,
  ALPINE_ISSUER,
  AUTHORITY,
  authorityMandate,
  contractingMandate,
  diagnosticMandate,
  NORDWERK,
  NW_CONTRACT,
  NW_DIAG,
  nordwerkInternalRoles,
  ORBIS,
  PLANNER,
  PROGRAMME,
  plannerMandate,
  providerMandate,
  providerSourceRules,
  REPRESENTATION,
  recipientSourceRules,
} from "../fixtures/industrial.js";
import type { TrustStoreData } from "../mechanisms/trust.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import { PURPOSE } from "../profile/vocabulary.js";
import { NOT_SENT_NOTICE, summariseStep } from "../service.js";
import { addSourceRule } from "../setup.js";
import { pinIssuersFromFiles, readJson, writeAtomic } from "./common.js";
import { durableHandler, scopedStateKey } from "./durable.js";
import type { Json, OperatorOperation, RoleDefinition } from "./types.js";

export const WORK_ORDERS_FILE = "industrial-work-orders.json";
export const PROVIDER_FILE = "industrial-provider.json";
export const MEMBERSHIP_FILE = "industrial-membership.json";
export const NW_STORE_FILE = "nordwerk-data-store.json";
export const NW_STORE_LEDGER_FILE = "nordwerk-data-store-ledger.jsonl";

const JWS = z
  .string()
  .min(16)
  .max(16 * 1024);
const IRI = z.string().min(8).max(512);
const PURPOSES = {
  maintenance: PURPOSE.maintenance,
  "product-development": PURPOSE.productDevelopment,
};
const purposeInput = z.enum(["maintenance", "product-development"]);

function horizon(now: Date): string {
  return new Date(now.getTime() + 365 * 86_400_000).toISOString();
}

/** Show a step's outbound for review (dispatch_outbound carries it). */
async function started(
  op: Parameters<ReturnType<RoleDefinition["build"]>["operations"]>[0],
  step: Awaited<ReturnType<typeof op.rt.startInvocation>>,
): Promise<Json> {
  return {
    step: summariseStep(step),
    outbound: op.show(await op.prepare(step.outbound)),
    notice: NOT_SENT_NOTICE,
  };
}

// ------------------------------------------------------------------ Alpine planner

const PLANNER_STATE = "planner";

export const INDUSTRIAL_PLANNER_ROLE: RoleDefinition = {
  id: "industrial-planner",
  label:
    "Synthetic Alpine maintenance planner — requests access authorisations, accepts recommendations, work orders",
  synthetic: true,
  identity: { party: PLANNER.party, actor: PLANNER.actor, operator: PLANNER.operator },
  mandate: plannerMandate,
  representationOperations: REPRESENTATION.planner,
  build(ctx) {
    const ordersPath = join(ctx.dir, WORK_ORDERS_FILE);
    const orders = new SyntheticWorkOrders({
      load: () =>
        readJson<{ orders: Record<string, WorkOrder> }>(ordersPath, { orders: {} }).orders,
      save: (o) => writeAtomic(ordersPath, { orders: o }),
    });
    const tpa = durableHandler(new AlpinePlannerHandler(INTERNAL_TPA_OP), {
      key: PLANNER_STATE,
      snapshot: (h): JsonValue => (h.authorisation ? { authorisation: h.authorisation } : {}),
      restore: (h, s) => {
        h.authorisation = (s as { authorisation?: string }).authorisation;
      },
    });
    return {
      handlers: [tpa, new AlpinePlannerHandler(RECOMMENDATION_OP)],
      effects: [ctx.wrapEffect(orders)],
      status: () => ({
        workOrders: Object.fromEntries(orders.orders),
      }),
      operations: (op): OperatorOperation[] => {
        const latest = () =>
          (op.rt.domainState(scopedStateKey(INTERNAL_TPA_OP, PLANNER_STATE)) ?? {}) as {
            authorisation?: string;
          };
        return [
          {
            name: "request_authorisation",
            title: "Ask Alpine's data authority for a third-party access authorisation",
            description:
              "Internal request to the PINNED data-authority agent: authorise ONE recipient to receive the asset's " +
              "telemetry from the data holder for maintenance. The authority decides under ITS mandate.",
            input: {
              authorityActor: IRI,
              recipient: IRI,
              dataHolder: IRI.optional(),
              windowHours: z.number().int().min(1).max(168).optional(),
              retentionDays: z.number().int().min(1).max(365).optional(),
            },
            async run(raw) {
              const a = raw as {
                authorityActor: string;
                recipient: string;
                dataHolder?: string;
                windowHours?: number;
                retentionDays?: number;
              };
              const end = op.now();
              const step = await op.rt.startInvocation({
                peer: op.pinnedPeer(a.authorityActor),
                operation: INTERNAL_TPA_OP,
                input: {
                  model: REQUEST_MODEL.id,
                  asset: ASSET,
                  dataHolder: a.dataHolder ?? ORBIS,
                  recipient: a.recipient,
                  window: {
                    start: new Date(
                      end.getTime() - (a.windowHours ?? 72) * 3_600_000,
                    ).toISOString(),
                    end: end.toISOString(),
                  },
                  purpose: PURPOSE.maintenance,
                  retentionDays: a.retentionDays ?? 30,
                },
                basis: { kind: "represented" },
                models: [REQUEST_MODEL],
                discover: false,
                configuration: CONFIG_ED25519,
              });
              return started(op, step);
            },
          },
          {
            name: "export_authorisation",
            title: "Export the latest issued authorisation (hand-over to the recipient's operator)",
            description:
              "Returns the signed authorisation for an OUT-OF-BAND hand-over to the recipient's operator (no " +
              "protocol message). It grants nothing by itself: the data holder verifies it against the PINNED " +
              "Alpine issuer key and its own source-authority rule.",
            readOnly: true,
            input: {},
            async run() {
              const jws = latest().authorisation;
              if (!jws)
                throw new Error("no authorisation issued yet (request_authorisation first)");
              const payload = tpaSchema.parse(
                JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")),
              );
              return { authorisation: jws, payload: payload as unknown as Json };
            },
          },
          {
            name: "record_performance",
            title: "Record the SIMULATED performance of a work order",
            description:
              "Marks one synthetic work order as completed-synthetic and records a performance observation, " +
              "separately from the agreement and the work order's creation. Idempotent; nothing real is scheduled.",
            input: { workOrder: z.string().min(1).max(64) },
            async run(raw) {
              const { workOrder } = raw as { workOrder: string };
              const entry = [...orders.orders.entries()].find(([, o]) => o.id === workOrder);
              if (!entry) throw new Error(`no work order ${workOrder}`);
              const [key, order] = entry;
              if (order.status === "completed-synthetic")
                return { workOrder, status: order.status, recorded: false };
              orders.orders.set(key, { ...order, status: "completed-synthetic" });
              writeAtomic(ordersPath, { orders: Object.fromEntries(orders.orders) });
              op.rt.recordObservation({
                type: "performance-observation",
                observedBy: "synthetic maintenance system",
                workOrder,
                status: "completed-synthetic",
                note: "simulated; no real maintenance scheduled",
              });
              return { workOrder, status: "completed-synthetic", recorded: true };
            },
          },
        ];
      },
    };
  },
};

// ------------------------------------------------------------------ Alpine data authority

export const INDUSTRIAL_AUTHORITY_ROLE: RoleDefinition = {
  id: "industrial-authority",
  label:
    "Synthetic Alpine data authority — issues third-party access authorisations with its own issuing key",
  synthetic: true,
  identity: { party: AUTHORITY.party, actor: AUTHORITY.actor, operator: AUTHORITY.operator },
  mandate: authorityMandate,
  representationOperations: REPRESENTATION.authority,
  issuingKey: {
    subject: ALPINE_ISSUER,
    note: "Alpine third-party-access authorisation issuer key: separate from the organisation owner key and the agent's actor key",
  },
  build(ctx) {
    if (!ctx.issuerKey) throw new Error("industrial-authority needs its issuing key");
    return {
      handlers: [
        new AlpineAuthorityHandler({
          user: ALPINE,
          issuer: ALPINE_ISSUER,
          issuerKey: ctx.issuerKey,
        }),
      ],
      effects: [],
      operations: () => [],
      status: () => ({ issuer: ALPINE_ISSUER }),
    };
  },
};

// ------------------------------------------------------------------ Orbis provider

const PROVIDER_STATE = "provider";
const providerFile = z.strictObject({ version: z.literal(1), model: z.enum(["current", "old"]) });

export const INDUSTRIAL_PROVIDER_ROLE: RoleDefinition = {
  id: "industrial-provider",
  label:
    "Synthetic Orbis telemetry provider — restricted offer, exact agreement, transfer only under agreement",
  synthetic: true,
  mandate: providerMandate,
  representationOperations: REPRESENTATION.provider,
  inputs: {
    issuers:
      "issuer public cards, comma-separated: the programme issuer (`synthetic-industrial`) and Alpine's authorisation issuer (`issuer-card --name <industrial-authority>`)",
    model: "VALUE 'current' (default) or 'old': the EquipmentHealth version this endpoint offers",
  },
  async init({ trust, now, options }) {
    if (!options.issuers)
      throw new Error("industrial-provider init needs --role-input issuers=FILE[,FILE]");
    let next: TrustStoreData = pinIssuersFromFiles(
      trust,
      options.issuers,
      "issuer pinned at the telemetry provider's provisioning",
    );
    for (const rule of providerSourceRules(horizon(now))) next = addSourceRule(next, rule);
    const file = providerFile.parse({ version: 1, model: options.model ?? "current" });
    return { trust: next, files: { [PROVIDER_FILE]: file } };
  },
  build(ctx) {
    const file = providerFile.parse(JSON.parse(readFileSync(join(ctx.dir, PROVIDER_FILE), "utf8")));
    const model = file.model === "old" ? EQUIPMENT_HEALTH_OLD : EQUIPMENT_HEALTH;
    const shared = {
      agreements: new Map<Iri, OfferTerms>(),
      delivered: new Map<Iri, string>(),
    };
    const cfg = {
      holder: ctx.party,
      programmeIssuer: PROGRAMME,
      userIssuer: ALPINE_ISSUER,
      telemetry: () => syntheticTelemetry(new Date(ctx.now().getTime() - 3_600_000)),
      shared,
      model,
    };
    const offer = new OrbisProviderHandler(DATA_OFFER_OP, cfg);
    const transfer = new OrbisProviderHandler(TRANSFER_OP, cfg);
    // Both handlers act in the agreement's conversation and share ONE durable state.
    const state = {
      key: PROVIDER_STATE,
      snapshot: () => ({
        agreements: Object.fromEntries(shared.agreements) as unknown as JsonValue,
        delivered: Object.fromEntries(shared.delivered),
        transfers: transfer.transfers as unknown as JsonValue,
      }),
      restore: (_h: OrbisProviderHandler, s: JsonValue) => {
        const saved = s as {
          agreements?: Record<Iri, OfferTerms>;
          delivered?: Record<Iri, string>;
          transfers?: OrbisProviderHandler["transfers"];
        };
        shared.agreements.clear();
        for (const [k, v] of Object.entries(saved.agreements ?? {})) shared.agreements.set(k, v);
        shared.delivered.clear();
        for (const [k, v] of Object.entries(saved.delivered ?? {})) shared.delivered.set(k, v);
        transfer.transfers.splice(0, transfer.transfers.length, ...(saved.transfers ?? []));
      },
    };
    return {
      handlers: [durableHandler(offer, state), durableHandler(transfer, state)],
      effects: [],
      operations: () => [],
      status: () => ({ model, offer: OFFER_ID }),
    };
  },
};

// ------------------------------------------------------------------ NordWerk contracting

const membershipFile = z.strictObject({
  version: z.literal(1),
  subject: IRI,
  credential: JWS,
  synthetic: z.literal(true),
});

function nordwerkStore(ctx: Parameters<RoleDefinition["build"]>[0]) {
  return new PurposeBoundStore(NORDWERK, nordwerkInternalRoles(), ctx.now, ctx.engine, {
    path: join(ctx.dir, NW_STORE_FILE),
    ledgerPath: join(ctx.dir, NW_STORE_LEDGER_FILE),
  });
}

export const INDUSTRIAL_CONTRACTING_ROLE: RoleDefinition = {
  id: "industrial-contracting",
  label:
    "Synthetic NordWerk contracting agent — exact agreement, transfer, purpose-bound store, internal reads",
  synthetic: true,
  identity: { party: NW_CONTRACT.party, actor: NW_CONTRACT.actor, operator: NW_CONTRACT.operator },
  mandate: contractingMandate,
  representationOperations: REPRESENTATION.contracting,
  inputs: { membership: "participant credential file (`synthetic-industrial`)" },
  async init({ trust, now, options }) {
    if (!options.membership)
      throw new Error("industrial-contracting init needs --role-input membership=FILE");
    const file = membershipFile.parse(JSON.parse(readFileSync(options.membership, "utf8")));
    if (file.subject !== NORDWERK) throw new Error("the credential is about another organisation");
    let next = trust;
    for (const rule of recipientSourceRules(horizon(now))) next = addSourceRule(next, rule);
    return { trust: next, files: { [MEMBERSHIP_FILE]: file } };
  },
  build(ctx) {
    const membership = membershipFile.parse(
      JSON.parse(readFileSync(join(ctx.dir, MEMBERSHIP_FILE), "utf8")),
    );
    const store = nordwerkStore(ctx);
    const cfg = { holder: ORBIS, recipient: NORDWERK, store, acceptedModels: [EQUIPMENT_HEALTH] };
    return {
      handlers: [
        new NordWerkContractHandler(DATA_OFFER_OP, cfg),
        new NordWerkContractHandler(TRANSFER_OP, cfg),
        new NordWerkDatasetHandler({ organisation: NORDWERK, store }),
      ],
      effects: [],
      // A queued internal dataset release leaves only if the store still permits it.
      disclosureChecks: { [PURPOSE_STORE_RELEASE_CONDITION]: purposeStoreReleaseCheck(store) },
      status: () => ({
        dataStore: store.inventory(),
        erased: store.tombstones().map((t) => ({ id: t.id, grant: t.grant, erasedAt: t.erasedAt })),
      }),
      operations: (op): OperatorOperation[] => [
        {
          name: "negotiate_offer",
          title: "Negotiate the provider's telemetry offer (exact terms)",
          description:
            "Describe then propose to a PINNED provider: the terms follow the Alpine authorisation handed over by " +
            "Alpine's operator (asset, window, its id); NordWerk's participant credential and that authorisation " +
            "travel as evidence. The provider decides eligibility, representation, authority, purpose and scope.",
          input: {
            providerActor: IRI,
            authorisation: JWS,
            purpose: purposeInput,
            retentionDays: z.number().int().min(1).max(365).optional(),
          },
          async run(raw) {
            const a = raw as {
              providerActor: string;
              authorisation: string;
              purpose: z.infer<typeof purposeInput>;
              retentionDays?: number;
            };
            // Read (NOT verify) the authorisation to build matching terms; the holder verifies.
            const tpa = tpaSchema.parse(
              JSON.parse(
                Buffer.from(a.authorisation.split(".")[1] ?? "", "base64url").toString("utf8"),
              ),
            );
            const step = await op.rt.startNegotiation({
              peer: op.pinnedPeer(a.providerActor),
              operation: DATA_OFFER_OP,
              terms: {
                model: EQUIPMENT_HEALTH.id,
                modelVersion: EQUIPMENT_HEALTH.version,
                offerId: OFFER_ID,
                asset: tpa.asset,
                window: tpa.window,
                purpose: PURPOSES[a.purpose],
                recipient: NORDWERK,
                retentionDays: a.retentionDays ?? tpa.retentionDays,
                noRedistribution: true,
                thirdPartyAuthorisation: tpa.id,
                synthetic: true,
              },
              models: [EQUIPMENT_HEALTH],
              evidence: [
                { role: "membership", format: "jws-compact", value: membership.credential },
                { role: "authorisation", format: "jws-compact", value: a.authorisation },
              ],
            });
            return started(op, step);
          },
        },
        {
          name: "request_transfer",
          title: "Request the telemetry transfer under an agreement",
          description:
            "Invoke the transfer in the conversation of an AGREED offer (no agreement → refused locally). The " +
            "received data is stored under the usage policy derived from the agreement.",
          input: { conversation: IRI },
          async run(raw) {
            const { conversation } = raw as { conversation: string };
            const phase = op.rt.conversation(conversation)?.phase ?? "unknown conversation";
            if (phase !== "agreed")
              throw new Error(
                `no transfer can be requested in this conversation (${phase}); it needs an agreed offer that is not yet performed`,
              );
            const step = await op.rt.invokeUnderAgreement({
              conversation,
              operation: TRANSFER_OP,
              input: { dataset: "vibration-temperature" },
              purpose: PURPOSE.maintenance,
            });
            return started(op, step);
          },
        },
      ],
    };
  },
};

// ------------------------------------------------------------------ NordWerk diagnostic

const DIAG_STATE = "diagnostic";

export const INDUSTRIAL_DIAGNOSTIC_ROLE: RoleDefinition = {
  id: "industrial-diagnostic",
  label:
    "Synthetic NordWerk diagnostic agent — internal dataset read, modelled assertion, recommendation",
  synthetic: true,
  identity: { party: NW_DIAG.party, actor: NW_DIAG.actor, operator: NW_DIAG.operator },
  mandate: diagnosticMandate,
  representationOperations: REPRESENTATION.diagnostic,
  build() {
    const reader = durableHandler(new DiagnosticReaderHandler(), {
      key: DIAG_STATE,
      snapshot: (h) => ({ diagnoses: h.diagnoses as unknown as JsonValue }),
      restore: (h, s) => {
        const saved = (s as { diagnoses?: DiagnosticReaderHandler["diagnoses"] }).diagnoses ?? [];
        h.diagnoses.splice(0, h.diagnoses.length, ...saved);
      },
    });
    return {
      handlers: [reader, new NordWerkDiagnosticHandler()],
      effects: [],
      operations: (op): OperatorOperation[] => {
        const diagnoses = () =>
          ((op.rt.domainState(scopedStateKey(DATASET_READ_OP, DIAG_STATE)) as JsonObject)
            ?.diagnoses ?? []) as DiagnosticReaderHandler["diagnoses"];
        return [
          {
            name: "read_dataset",
            title: "Ask NordWerk's enforcement point for a stored dataset",
            description:
              "Internal request to the PINNED contracting agent (which holds NordWerk's store). The store decides for " +
              "the VERIFIED requesting agent and the stated purpose; on release a diagnosis is derived at once and " +
              "only the modelled assertion is kept.",
            input: { contractingActor: IRI, dataset: IRI, purpose: purposeInput },
            async run(raw) {
              const a = raw as {
                contractingActor: string;
                dataset: string;
                purpose: z.infer<typeof purposeInput>;
              };
              const step = await op.rt.startInvocation({
                peer: op.pinnedPeer(a.contractingActor),
                operation: DATASET_READ_OP,
                input: { dataset: a.dataset, purpose: PURPOSES[a.purpose] },
                basis: { kind: "represented" },
                models: [EQUIPMENT_HEALTH],
                discover: false,
                configuration: CONFIG_ED25519,
              });
              return started(op, step);
            },
          },
          {
            name: "recommend",
            title: "Propose a maintenance recommendation to the planner",
            description:
              "Propose the LATEST diagnosis (a modelled assertion with its limitations and the dataset it is based " +
              "on) to a PINNED planner, who accepts or refuses it under its own rule.",
            input: { plannerActor: IRI, withinDays: z.number().int().min(1).max(60).optional() },
            async run(raw) {
              const a = raw as { plannerActor: string; withinDays?: number };
              const d = diagnoses().at(-1);
              if (!d) throw new Error("no diagnosis yet (read_dataset first)");
              const r = d.result as {
                stale?: true;
                detail?: string;
                risk?: "low" | "medium" | "high";
                confidence?: number;
                limitations?: string[];
              };
              if (r.stale) throw new Error(`latest diagnosis is stale: ${r.detail}`);
              const step = await op.rt.startNegotiation({
                peer: op.pinnedPeer(a.plannerActor),
                operation: RECOMMENDATION_OP,
                terms: {
                  model: RECOMMENDATION_MODEL.id,
                  asset: ASSET,
                  assertion: {
                    risk: r.risk ?? "low",
                    confidence: r.confidence ?? 0,
                    basis: [d.dataset],
                    limitations: r.limitations ?? [],
                  },
                  proposedAction: {
                    kind: "inspect-bearing",
                    withinDays: a.withinDays ?? 7,
                    cost: 0,
                  },
                  dataset: d.dataset,
                  synthetic: true,
                },
                models: [RECOMMENDATION_MODEL],
              });
              return started(op, step);
            },
          },
        ];
      },
      status: () => ({}),
    };
  },
};
