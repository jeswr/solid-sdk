/**
 * Two separately configured personal agents (Alice, Bob) with their own owners, keys,
 * mandates, trust stores, synthetic calendars and persistent stores. Used by the tests,
 * the CLI and the demo report. All identifiers use reserved example domains.
 */
import { join } from "node:path";
import type { Iri } from "../core/types.js";
import {
  type CalendarData,
  CalendarHoldAdapter,
  SCHEDULE_OP,
  SchedulingHandler,
  SyntheticCalendar,
} from "../domains/scheduling.js";
import { schedulingMandate } from "../mandates.js";
import type { KeyAlg } from "../mechanisms/jws.js";
import type { OwnerMandate } from "../mechanisms/mandate.js";
import { TrustStore } from "../mechanisms/trust.js";
import { CONFIG_ED25519, CONFIG_P256 } from "../profile/configurations.js";
import { AgentRuntime, type AgentRuntimeOptions } from "../runtime/agent.js";
import type { EffectAdapter } from "../runtime/operations.js";
import { type Identity, introduce, type ProvisionedAgent, provisionAgent } from "../setup.js";
import { type EvidenceLedger, FileLedger, MemoryLedger } from "../store/ledger.js";
import { FileStateStore, MemoryStateStore, type StateStore } from "../store/state.js";
import { scenarioPolicyEngine } from "./policy.js";

export const ALICE: Identity = {
  name: "alice",
  party: "https://alice.example/#me",
  actor: "https://agents.alice.example/personal#agent",
  operator: "https://alice.example/#me",
  email: "alice.awp@example.com",
};

export const BOB: Identity = {
  name: "bob",
  party: "https://bob.example/#me",
  actor: "https://agents.hostco.example/bob#agent",
  operator: "https://hostco.example/#org",
  email: "bob.awp@example.com",
};

export function londonCalendar(): CalendarData {
  return {
    timeZone: "Europe/London",
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    busy: [{ start: "2026-10-20T13:00:00Z", end: "2026-10-20T14:00:00Z" }],
    holds: {},
  };
}

export function newYorkCalendar(): CalendarData {
  return {
    timeZone: "America/New_York",
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    busy: [{ start: "2026-10-20T14:00:00Z", end: "2026-10-20T15:00:00Z" }],
    holds: {},
  };
}

export interface PersonalAgent {
  readonly provisioned: ProvisionedAgent;
  readonly calendar: SyntheticCalendar;
  readonly runtime: AgentRuntime;
  readonly ledger: EvidenceLedger;
}

export interface PairOptions {
  readonly now: () => Date;
  /** Directory for persistent state; memory stores when absent. */
  readonly dir?: string;
  readonly aliceAlg?: KeyAlg;
  readonly bobAlg?: KeyAlg;
  readonly aliceAccepted?: readonly string[];
  readonly bobAccepted?: readonly string[];
  readonly aliceMandate?: (ids: {
    owner: Iri;
    actor: Iri;
    validFrom: string;
    validUntil: string;
  }) => OwnerMandate;
  readonly bobMandate?: (ids: {
    owner: Iri;
    actor: Iri;
    validFrom: string;
    validUntil: string;
  }) => OwnerMandate;
  readonly aliceCalendar?: CalendarData;
  readonly bobCalendar?: CalendarData;
  readonly validityDays?: number;
  readonly bobRepresentationOps?: readonly Iri[];
}

function acceptedFor(alg: KeyAlg): string[] {
  return alg === "EdDSA" ? [CONFIG_ED25519] : [CONFIG_P256];
}

/** Provision both identities and pin each other's cards (the reviewed introduction). */
export async function provisionPair(
  opts: PairOptions,
): Promise<{ alice: ProvisionedAgent; bob: ProvisionedAgent }> {
  const now = opts.now();
  const alice = await provisionAgent({
    identity: ALICE,
    alg: opts.aliceAlg ?? "EdDSA",
    now,
    mandate: opts.aliceMandate ?? schedulingMandate([BOB.party]),
    representationOperations: [SCHEDULE_OP.id],
    ...(opts.validityDays ? { validityDays: opts.validityDays } : {}),
  });
  const bob = await provisionAgent({
    identity: BOB,
    alg: opts.bobAlg ?? "EdDSA",
    now,
    mandate: opts.bobMandate ?? schedulingMandate([ALICE.party]),
    representationOperations: opts.bobRepresentationOps ?? [SCHEDULE_OP.id],
    ...(opts.validityDays ? { validityDays: opts.validityDays } : {}),
  });
  return {
    alice: { ...alice, trust: introduce(alice.trust, bob.card) },
    bob: { ...bob, trust: introduce(bob.trust, alice.card) },
  };
}

export async function startAgent(
  p: ProvisionedAgent,
  calendarData: CalendarData,
  opts: {
    now: () => Date;
    dir?: string;
    accepted: readonly string[];
    /** Test/integration hooks: inject a store, a shared calendar, wrap the adapter. */
    store?: StateStore;
    calendar?: SyntheticCalendar;
    ledger?: EvidenceLedger;
    wrapAdapter?: (adapter: EffectAdapter) => EffectAdapter;
    runtime?: Pick<
      AgentRuntimeOptions,
      "trackHandOff" | "effectTimeoutMs" | "retention" | "limits" | "policyEngine"
    >;
  },
): Promise<PersonalAgent> {
  const name = p.identity.name;
  const calendar =
    opts.calendar ??
    (opts.dir
      ? SyntheticCalendar.open(join(opts.dir, `${name}-calendar.json`), calendarData)
      : new SyntheticCalendar(structuredClone(calendarData)));
  const ledger =
    opts.ledger ??
    (opts.dir ? new FileLedger(join(opts.dir, `${name}-ledger.jsonl`)) : new MemoryLedger());
  const store =
    opts.store ??
    (opts.dir ? new FileStateStore(join(opts.dir, `${name}-state.json`)) : new MemoryStateStore());
  const adapter = new CalendarHoldAdapter(calendar);
  const runtime = await AgentRuntime.create({
    identity: {
      actor: p.identity.actor,
      party: p.identity.party,
      ...(p.identity.operator ? { operator: p.identity.operator } : {}),
    },
    actorKeys: [p.actorKey],
    trust: await TrustStore.load(p.trust),
    mandateJws: p.mandateJws,
    representationJws: p.representationJws,
    accepted: opts.accepted,
    handlers: [new SchedulingHandler(calendar)],
    effects: [opts.wrapAdapter ? opts.wrapAdapter(adapter) : adapter],
    store,
    ledger,
    now: opts.now,
    ...(scenarioPolicyEngine() ? { policyEngine: scenarioPolicyEngine() } : {}),
    ...(opts.runtime ?? {}),
    bindings: [
      { id: "direct-local/0.1" },
      ...(p.identity.email
        ? [{ id: "email-mime/0.1", endpoint: `mailto:${p.identity.email}` }]
        : []),
    ],
    conformance: [
      {
        claim: "scheduling negotiation over signed-ed25519/0.1 between two local agents",
        level: "self-test-real-crypto",
        evidence: "src/pilot/scheduling.test.ts; reports/pilot-demo-report.json",
      },
    ],
  });
  return { provisioned: p, calendar, runtime, ledger };
}

export async function personalPair(
  opts: PairOptions,
): Promise<{ alice: PersonalAgent; bob: PersonalAgent }> {
  const { alice, bob } = await provisionPair(opts);
  return {
    alice: await startAgent(alice, opts.aliceCalendar ?? londonCalendar(), {
      now: opts.now,
      ...(opts.dir ? { dir: opts.dir } : {}),
      accepted: opts.aliceAccepted ?? acceptedFor(opts.aliceAlg ?? "EdDSA"),
    }),
    bob: await startAgent(bob, opts.bobCalendar ?? newYorkCalendar(), {
      now: opts.now,
      ...(opts.dir ? { dir: opts.dir } : {}),
      accepted: opts.bobAccepted ?? acceptedFor(opts.bobAlg ?? "EdDSA"),
    }),
  };
}

/** A fixed synthetic clock: Monday 19 October 2026, 08:00 UTC. */
export function fixedClock(iso = "2026-10-19T08:00:00Z"): {
  now: () => Date;
  advance: (ms: number) => void;
  set: (iso: string) => void;
} {
  let t = Date.parse(iso);
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms;
    },
    set: (v) => {
      t = Date.parse(v);
    },
  };
}
