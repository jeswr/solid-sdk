// AUTHORED-BY Codex GPT-6
/** Fictional, in-process protocol world. Private keys stay in the host and selected adapter. */

import { digestOf } from "../core/canonical.js";
import type { AnyMessage, JsonObject } from "../core/types.js";
import { generateSigningKey } from "../mechanisms/jws.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { MessageNode } from "../model/message-nodes.js";
import { PILOT_PROFILE } from "../profile/vocabulary.js";
import type { AgentRuntime } from "../runtime/agent.js";
import type { Cast } from "../scenarios/common.js";
import { AcpSuite } from "../settlement/acp/index.js";
import { type AdapterProfile, publishProtocolKey, type Step } from "../settlement/adapter.js";
import { Ap2Suite } from "../settlement/ap2/index.js";
import { addressFromKey } from "../settlement/eip3009.js";
import type { Ledger } from "../settlement/ledger.js";
import { MppSuite } from "../settlement/mpp/index.js";
import type { ProtocolObjects, SettlementSuite } from "../settlement/types.js";
import { X402Suite } from "../settlement/x402/index.js";
import { accountIri } from "../settlement/x402/lift.js";
import { packetView } from "../trace/packet.js";
import type { TraceRecorder } from "../trace/recorder.js";
import { writeMessagePacket } from "../wire/message-packet.js";
import type { DomainProfile, Scenario } from "./schema.js";
import { tamperSettlementOrder } from "./settlement-faults.js";

const payerId = "sam-agent",
  merchantId = "valuer-agent",
  providerId = "payment-provider-agent";
export const PROCESSOR = "urn:fictional:merchant-processor";
const secret = Uint8Array.from([...new Uint8Array(31), 1]);
const merchantAccount = "0x2222222222222222222222222222222222222222";
const domain = {
  name: "USD Coin",
  version: "2",
  chainId: "84532",
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
/** Only alternative worlds get the authenticated account/key/processor infrastructure. */
export function settlementWorld(scenario: Scenario, profile: DomainProfile, suite: string): void {
  for (const step of scenario.script)
    if ("intent" in step && step.intent?.action === "pay") {
      const parameters = step.intent.parameters as JsonObject;
      parameters.validUntil = "2026-11-13T09:05:00.000Z";
    }
  const evm = suite === "x402" || suite === "mpp";
  if (evm) {
    const replace = (v: unknown): unknown => {
      if (v === "urn:account:sam") return addressFromKey(secret);
      if (v === "urn:account:bracken-lantern") return accountIri(merchantAccount, "eip155:84532");
      if (Array.isArray(v)) return v.map(replace);
      if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
      return v;
    };
    Object.assign(scenario, replace(scenario));
    const accounts = scenario.paymentProviders[0]?.accounts;
    const merchant = accounts?.find((a) => a.id === accountIri(merchantAccount, "eip155:84532"));
    if (merchant) merchant.id = merchantAccount;
  }
  if (suite === "acp") {
    for (const account of scenario.paymentProviders[0]?.accounts ?? [])
      account.balances = Object.fromEntries(
        Object.entries(account.balances).map(([c, a]) => [c.toLowerCase(), a]),
      );
  }
  if (suite === "ap2") {
    const original = scenario.parties.find((p) => p.id === providerId)!;
    scenario.parties.push(
      {
        ...scenario.parties.find((p) => p.id === "payment-provider")!,
        id: "processor",
        identity: PROCESSOR,
        name: "The fictional merchant payment processor",
      },
      {
        ...original,
        id: "processor-agent",
        identity: "urn:fictional:processor-agent",
        actor: "urn:fictional:processor-agent:actor",
        actsFor: "processor",
        name: "The fictional processor's agent",
      },
    );
    scenario.mandates.push({
      ...scenario.mandates.find((m) => m.agent === providerId)!,
      agent: "processor-agent",
    });
    for (const step of scenario.script)
      if (step.id === "provider-receipt-statement" && step.type === "issue") {
        step.issuer = "processor-agent";
        step.value.issuer = PROCESSOR;
      }
    for (const claim of profile.claims)
      if (claim.kind === "payment-receipt") claim.sources = [PROCESSOR];
    for (const rules of Object.values(scenario.trust.sources))
      rules.push({
        id: "urn:source:processor:receipt",
        version: "1",
        source: PROCESSOR,
        claimTypes: ["payment-receipt"],
        subjects: "any",
      });
  }
  const parties = scenario.parties.filter(
    (p) =>
      p.runs === "agent" && [payerId, merchantId, providerId, "processor-agent"].includes(p.id),
  );
  const sources = parties.map(
    (p) => scenario.parties.find((principal) => principal.id === p.actsFor)!.identity,
  );
  for (const kind of ["settlement-key", "settlement-object"]) {
    profile.claims.push({ kind, sources, methods: ["recorded-by-authority"], maxAgeDays: 1 });
    for (const party of parties) {
      scenario.trust.sources[party.id] ??= [];
      for (const source of sources)
        scenario.trust.sources[party.id]!.push({
          id: `urn:source:${party.id}:${kind}:${digestOf(source).slice(8)}`,
          version: "1",
          source,
          claimTypes: [kind],
          subjects: "any",
        });
    }
  }
  for (const a of parties)
    for (const b of parties)
      if (
        a.id < b.id &&
        !scenario.trust.introductions.some(
          ([x, y]) => (x === a.id && y === b.id) || (x === b.id && y === a.id),
        )
      )
        scenario.trust.introductions.push([a.id, b.id]);
}

export async function liveSettlement(input: {
  suite: string;
  fault?: "tampered-order";
  cast: Cast;
  runtimes: Map<string, AgentRuntime>;
  ledger: Ledger;
  now: () => string;
  recorder: TraceRecorder;
  configuration: string;
}): Promise<SettlementSuite> {
  const { suite, cast, runtimes, ledger, now, recorder, configuration } = input;
  const payer = cast.get(payerId),
    merchant = cast.get(merchantId),
    provider = cast.get(providerId);
  const delivered = new Set<string>();
  let sequence = 0;
  const route = (name: string): [string, string] => {
    if (name.startsWith("/verify") || name.startsWith("/settle"))
      return name.endsWith("request") ? [merchantId, providerId] : [providerId, merchantId];
    if (
      [
        "PaymentPayload",
        "Credential",
        "Checkout Mandate",
        "Complete checkout request",
        "Create checkout request",
      ].includes(name)
    )
      return [payerId, merchantId];
    if (["Payment Mandate", "Delegate payment request"].includes(name))
      return [payerId, providerId];
    if (name === "Delegated payment" || name === "payment-receipt") return [providerId, payerId];
    if (name === "Payment Receipt") return ["processor-agent", merchantId];
    return [merchantId, payerId];
  };
  const send = async (
    fromId: string,
    toId: string,
    object: ProtocolObjects["objects"][number],
    step: Step,
  ) => {
    const key = digestOf({
      fromId,
      toId,
      name: object.name,
      form: object.form,
      raw: object.raw ?? object.shown,
    });
    if (delivered.has(key)) return;
    const from = cast.get(fromId),
      to = cast.get(toId);
    const observed = { suite, objects: [object] } as unknown as JsonObject;
    const id = `urn:settlement:${suite}:${++sequence}`;
    const claim = {
      id: `${id}:source`,
      issuer: from.identity.party,
      subject: from.identity.party,
      claimType: step === "protocol-key" ? "settlement-key" : "settlement-object",
      method: "recorded-by-authority",
      asOf: now(),
      objectDigest: digestOf(observed),
      terms: {
        policy: {
          id: `${id}:terms`,
          permissions: [
            {
              type: "permission",
              action: "use",
              constraints: [
                { leftOperand: "purpose", operator: "eq", rightOperand: "urn:purpose:valuation" },
              ],
            },
          ],
        },
      },
    };
    const message = {
      profile: PILOT_PROFILE,
      configuration,
      id,
      conversation: `${id}:conversation`,
      kind: "receipt",
      from: { actor: from.identity.actor, onBehalfOf: from.identity.party },
      to: { actor: to.identity.actor, party: to.identity.party },
      createdAt: now(),
      expiresAt: new Date(Date.parse(now()) + 300_000).toISOString(),
      body: { activity: `${id}:activity`, ref: id, outcome: "completed", final: true, observed },
      evidence: [
        {
          role: "credential",
          format: "jws-compact",
          value: await signStatement(from.ownerKey, TYP.statement, claim),
        },
      ],
    } as AnyMessage;
    const wire = await writeMessagePacket(MessageNode.toNode(message), {
      suite: "jws",
      key: from.actorKey,
      verificationMethod: `urn:awp:key:${from.actorKey.kid}`,
      created: now(),
    });
    await runtimes.get(toId)!.admitSettlementMessage(wire);
    recorder.sink(fromId).emit({
      part: "transport",
      kind: "message-out",
      caption: "The host passes the exact protocol object to its recipient.",
      packet: packetView(message, wire, {
        carriageSuite: "direct-http",
        carriageSummary: "Exact protocol object passed in process.",
        name: (id) =>
          id === from.identity.actor
            ? fromId
            : id === to.identity.actor
              ? toId
              : "The fictional party",
      }),
    });
    delivered.add(key);
  };
  let faultApplied = false;
  const admit: AdapterProfile["admit"] = async (source, step, objects) => {
    if (input.fault === "tampered-order" && step === "payment" && !faultApplied)
      faultApplied = tamperSettlementOrder(objects);
    if (step === "protocol-key") {
      const from = [...cast.agents].find(([, p]) => p.identity.party === source)?.[0];
      if (!from) throw new Error("source-not-authoritative");
      for (const to of [
        payerId,
        merchantId,
        providerId,
        ...(suite === "ap2" ? ["processor-agent"] : []),
      ])
        for (const object of objects.objects) await send(from, to, object, step);
      return;
    }
    for (const object of objects.objects) {
      if (object.name.startsWith("SettlementKey")) continue;
      const [from, to] =
        suite === "ap2" && source === merchant.identity.party && object.name === "Payment Receipt"
          ? [merchantId, payerId]
          : route(object.name);
      await send(from, to, object, step);
    }
  };
  const profile: AdapterProfile = {
    payer: {
      party: payer.identity.party,
      identity: payer.ownerKey,
      account: suite === "x402" || suite === "mpp" ? addressFromKey(secret) : "urn:account:sam",
    },
    merchant: {
      party: merchant.identity.party,
      identity: merchant.ownerKey,
      account:
        suite === "x402" || suite === "mpp" ? merchantAccount : "urn:account:bracken-lantern",
    },
    provider: {
      party: provider.identity.party,
      identity: provider.ownerKey,
      signingKey: provider.ownerKey,
    },
    currency: "USD",
    decimals: 2,
    ledger,
    now,
    admit,
  };
  const statement = async (
    party: string,
    key: typeof payer.ownerKey,
    algorithm: "ES256" | "secp256k1",
    publicKey: unknown,
  ) =>
    publishProtocolKey(key, {
      type: "SettlementKey",
      party,
      suite,
      algorithm,
      publicKey: publicKey as Record<string, string>,
      validFrom: now(),
      validUntil: "2026-11-20T09:00:00.000Z",
    });
  if (suite === "x402" || suite === "mpp") {
    const keyStatement = await statement(
      profile.payer.party,
      payer.ownerKey,
      "secp256k1",
      profile.payer.account,
    );
    return suite === "x402"
      ? new X402Suite({
          ...profile,
          settlementKey: secret,
          keyStatement,
          requirements: {
            scheme: "exact",
            network: "eip155:84532",
            amount: "45000",
            asset: domain.verifyingContract,
            payTo: merchantAccount,
            maxTimeoutSeconds: 300,
            extra: { name: domain.name, version: domain.version },
          },
        })
      : new MppSuite({
          ...profile,
          settlementKey: secret,
          keyStatement,
          domain,
          challengeSecret: new Uint8Array(32).fill(7),
        });
  }
  if (suite === "acp")
    return new AcpSuite({
      ...profile,
      agentKey: payer.ownerKey,
      merchantKey: merchant.ownerKey,
      bearerToken: "fictional-provider-account",
      handlerId: "fictional-provider",
    });
  if (suite === "ap2") {
    const processor = cast.get("processor-agent");
    const bound = async (party: typeof payer) => {
      const key = (await generateSigningKey("ES256")).key;
      return {
        key,
        statement: await statement(party.identity.party, party.ownerKey, "ES256", key.publicJwk),
      };
    };
    return new Ap2Suite({
      ...profile,
      personKey: await bound(payer),
      merchantKey: await bound(merchant),
      processor: { party: PROCESSOR, identity: processor.ownerKey, ...(await bound(processor)) },
    });
  }
  throw new Error("No selected protocol adapter");
}
