// AUTHORED-BY Codex GPT-6
/** Offline E0. Prototype observers are installed only in this process and restored in finally. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join, resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { digestOf } from "../../dist/core/canonical.js";
import { loadCase } from "../../dist/engine/load.js";
import { patch, runScenario } from "../../dist/engine/run.js";
import { domainProfileSchema, scenarioSchema } from "../../dist/engine/schema.js";
import {
  changeCommitment,
  generateFaults,
  laterMessage,
  whoWasAtFault,
} from "../../dist/eval/faults.js";
import { mutations, unspecified } from "../../dist/eval/mutations.js";
import { properties, readMandate, readTerms } from "../../dist/eval/properties.js";
import { GateMemory } from "../../dist/gates/common.js";
import { Admission, InboundGate } from "../../dist/gates/inbound.js";
import { OutboundGate } from "../../dist/gates/outbound.js";
import { LocalAgreementCoordinator } from "../../dist/mechanisms/agreements.js";
import { LocalDatasetHolder } from "../../dist/mechanisms/dataset-query.js";
import { LocalResourceHolder } from "../../dist/mechanisms/references.js";
import { signStatement } from "../../dist/mechanisms/statements.js";
import { TrustStore } from "../../dist/mechanisms/trust.js";
import { testKey } from "../../dist/reference/keys.js";
import { AgentRuntime } from "../../dist/runtime/agent.js";
import { MemoryLedger } from "../../dist/store/ledger.js";
import { MemoryStateStore } from "../../dist/store/state.js";

const option = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(option("out", join(directory, "eval/e0")));
mkdirSync(out, { recursive: true });
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (name, value) =>
  writeFileSync(
    join(out, name),
    `${JSON.stringify({ "x-authored-by": "Codex GPT-6", ...value }, null, 2)}\n`,
  );
const seed = Number(option("seed", "20261113"));
const N = Number(option("n", "200"));
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(N) || N < 0)
  throw new Error("seed and n must be integers; n must be nonnegative");
function gitCommit() {
  const root = resolve(directory, "../..");
  const dot = join(root, ".git");
  let git = dot;
  try {
    const pointer = readFileSync(dot, "utf8");
    if (pointer.startsWith("gitdir: ")) git = resolve(root, pointer.slice(8).trim());
  } catch {}
  const head = readFileSync(join(git, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const common = existsSync(join(git, "commondir"))
    ? resolve(git, readFileSync(join(git, "commondir"), "utf8").trim())
    : git;
  const ref = head.slice(5);
  for (const base of [git, common])
    if (existsSync(join(base, ref))) return readFileSync(join(base, ref), "utf8").trim();
  return (
    readFileSync(join(common, "packed-refs"), "utf8")
      .split("\n")
      .find((l) => l.endsWith(` ${ref}`))
      ?.split(" ")[0] ?? "unknown"
  );
}
const commit = gitCommit();
const start = performance.now();
const manifest = read(join(directory, "scenario-runs.json"));
const catalogue = read(join(directory, "eval/e0/catalogue.json"));
const paths = manifest.paths.filter((p) => ["runs", "agrees", "disagrees"].includes(p.status));
const selected = option("scenario", "");
const activePaths = paths.filter((p) => !selected || p.scenario === selected);
const restore = [];
const original = (klass, name, replacement) => {
  const previous = klass[name];
  klass[name] = replacement(previous);
  restore.push(() => {
    klass[name] = previous;
  });
};
let probing = false;
let current;
let creationIndex = 0;
let contexts = [];
const contextOf = new WeakMap();
const memoryOwner = new WeakMap();
const admissions = new WeakMap();
const shown = new WeakMap();
const actorRuntime = new Map();
const keyCache = new Map();
const decode = (jws) => JSON.parse(Buffer.from(jws.split(".")[1], "base64url").toString("utf8"));
const header = (jws) => JSON.parse(Buffer.from(jws.split(".")[0], "base64url").toString("utf8"));
const keysFor = async (world) => {
  const result = new Map();
  for (const party of world.parties) {
    for (const role of party.runs === "agent" ? ["actor", "owner"] : ["issuer"]) {
      const label = `engine/${party.id}/${role}`;
      if (!keyCache.has(label)) keyCache.set(label, await testKey(label));
      const key = keyCache.get(label);
      result.set(key.kid, key);
    }
  }
  return result;
};
const memoryNames = [
  "contexts",
  "identifiers",
  "refusals",
  "relianceHolds",
  "relianceBindings",
  "precedenceHolds",
];
const stateNames = [
  "contextItems",
  "knownIdentifiers",
  "statementRefusals",
  "relianceHolds",
  "relianceBindings",
  "precedenceHolds",
];
const memoryAliases = (memory, state) =>
  memoryNames.map((name, i) => memory[name] === state[stateNames[i]]);
const cloneMemory = (m, state, aliases = []) => {
  const result = new GateMemory(
    ...memoryNames.map((name, i) =>
      state && aliases[i] ? state[stateNames[i]] : structuredClone(m[name]),
    ),
  );
  for (const [id, fact] of m.facts) result.facts.set(id, structuredClone(fact));
  admissions.set(result, new Set(admissions.get(m) ?? []));
  return result;
};
function recordOf(runtime) {
  return {
    party: runtime.identity.party ?? runtime.identity.actor,
    actor: runtime.identity.actor,
    entries: structuredClone(runtime.ledger.entries()),
    messages: Object.values(runtime.state.recordMessages).map((v) => ({
      direction: v.direction,
      jws: v.jws,
    })),
  };
}
function stateOf(runtime, intent) {
  return structuredClone({
    actor: runtime.identity.actor,
    at: runtime.now(),
    withdrawn: runtime.mandateStatus().revoked,
    items: [
      ...runtime.gateMemory.facts.values(),
      ...runtime.gateMemory.context(runtime.options.gates?.taskId ?? intent.conversation),
    ].filter((item, i, all) => all.findIndex((x) => x.digest === item.digest) === i),
    approvals: Object.fromEntries(
      Object.entries(runtime.state.approvals).filter(
        ([, a]) => a.validUntil > runtime.now() && !runtime.state.usedApprovals[a.id],
      ),
    ),
    admissionDigests: [...(admissions.get(runtime.gateMemory) ?? [])],
    shownDigests: [...(shown.get(runtime) ?? [])],
  });
}

// An isolated synchronous outbound transaction. All runtime callbacks read the swapped state.
function probeOutbound(runtime, proposal, { repeat = false, withdraw = false } = {}) {
  const saved = Object.fromEntries(
    ["state", "gateMemory", "outbound", "inbound", "ledger", "decisions", "options"].map((k) => [
      k,
      runtime[k],
    ]),
  );
  const events = [];
  const state = stateOf(runtime, proposal);
  const mandate = runtime.mandate?.mandate;
  try {
    runtime.state = structuredClone(saved.state);
    runtime.gateMemory = cloneMemory(
      saved.gateMemory,
      runtime.state,
      memoryAliases(saved.gateMemory, saved.state),
    );
    runtime.ledger = new MemoryLedger();
    runtime.decisions = [];
    runtime.options = {
      ...saved.options,
      gates: { ...saved.options.gates, sink: { emit: (e) => events.push(e) } },
    };
    runtime.outbound = new OutboundGate({
      ...saved.outbound.deps,
      memory: runtime.gateMemory,
      gate: { ...saved.outbound.deps.gate, sink: { emit: (e) => events.push(e) } },
    });
    let gateMandateReading;
    const release = runtime.outbound.release;
    runtime.outbound.release = (intent, decision) => {
      gateMandateReading = structuredClone(decision);
      return release.call(runtime.outbound, intent, decision);
    };
    runtime.inbound = new InboundGate({
      ...saved.inbound.deps,
      memory: runtime.gateMemory,
      record: (r) => runtime.ledger.append(r, runtime.now()),
      gate: { ...saved.inbound.deps.gate, sink: { emit: (e) => events.push(e) } },
    });
    runtime.inbound.authorityByConversation = new Map(saved.inbound.authorityByConversation);
    if (withdraw && runtime.mandate) {
      runtime.state.revokedMandates.push({
        id: mandate.id,
        version: mandate.version,
        digest: runtime.mandate.digest,
        at: runtime.now(),
      });
      runtime.ledger.append(
        {
          type: "mandate-revoked",
          mandate: mandate.id,
          version: mandate.version,
          at: runtime.now(),
        },
        runtime.now(),
      );
      state.withdrawn = true;
    }
    let decision = savedAuthorise.call(runtime, proposal);
    if (repeat && decision.outcome === "permit") {
      runtime.outbound.sealEffect(proposal);
      decision = savedAuthorise.call(runtime, proposal);
      state.approvals = Object.fromEntries(
        Object.entries(runtime.state.approvals).filter(
          ([, a]) => !runtime.state.usedApprovals[a.id],
        ),
      );
    }
    const terminal = events.findLast((e) => e.part === "outbound-gate" && e.kind === "decision");
    const check =
      events.findLast(
        (e) => e.kind === "check" && e.verdict !== "pass" && e.verdict !== "not-applicable",
      ) ?? events.findLast((e) => e.kind === "check");
    const outcome =
      terminal?.outcome ??
      (decision.outcome === "permit"
        ? "go"
        : decision.outcome === "approval-required"
          ? "ask-principal"
          : "stop");
    const entries = runtime.ledger.entries();
    const input = {
      mandate,
      state,
      proposal,
      decision: { outcome, authorisation: decision },
      record: {
        decisions: entries
          .filter((e) => e.record.type === "authorisation-decision")
          .map((e) => e.record),
        beforeEffect: true,
      },
    };
    return {
      proposal,
      outcome,
      check: check?.check,
      reason: terminal?.reason ?? check?.reason ?? decision.reason,
      gateReading: decision,
      gateMandateReading,
      referenceReading: readMandate(mandate, state, proposal),
      termsReadings: state.items
        .filter(
          (i) =>
            Array.isArray(proposal.parameters.evidence) &&
            proposal.parameters.evidence.includes(i.id),
        )
        .map((i) => ({ id: i.id, reading: readTerms(i.terms, i, state, proposal) })),
      violations: Object.entries(properties)
        .filter(([, predicate]) => !predicate(input))
        .map(([id]) => id),
      state,
      mandate,
      record: entries,
      events,
    };
  } finally {
    Object.assign(runtime, saved);
  }
}
const savedAuthorise = AgentRuntime.prototype.authorise;

function rng(label) {
  let s = Number.parseInt(digestOf({ seed, label }).slice(-8), 16) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const pick = (values, random) => values[Math.floor(random() * values.length)];
function actionTypes(context) {
  const p = context.profile;
  return [
    ...new Set([
      ...p.actionClaims.map((r) => r.action).filter((a) => !a.includes(":")),
      ...p.singleUse.map((r) => r.action),
      ...context.world.mandates.flatMap((m) =>
        [...m.autonomous, ...m.withApproval, ...m.prohibitions].map((r) => r.action),
      ),
    ]),
  ].sort();
}
function attackers(context, runtime, intent) {
  const proposals = [];
  const push = (mutation, proposal, options) => proposals.push({ mutation, proposal, options });
  for (const recipient of [
    ...new Set(context.world.parties.map((p) => p.identity)),
    "urn:e0:unknown-party",
  ])
    if (recipient !== intent.recipient) push("recipient", { ...intent, recipient });
  for (const item of stateOf(runtime, intent).items) {
    const evidence = Array.isArray(intent.parameters.evidence) ? intent.parameters.evidence : [];
    if (!evidence.includes(item.id))
      push("held-item", {
        ...intent,
        parameters: { ...intent.parameters, evidence: [...evidence, item.id] },
      });
  }
  const limits = runtime.options.gates?.principalLimits;
  const policyLimits = [
    ...(runtime.mandate?.mandate.autonomous.permissions ?? []),
    ...(runtime.mandate?.mandate.withApproval.permissions ?? []),
  ].flatMap((r) => (r.limit ? [r.limit.perAction, r.limit.perPeriod] : []));
  function numbers(value, trail = []) {
    for (const [key, v] of Object.entries(value)) {
      if (v && typeof v === "object") numbers(v, [...trail, key]);
      else if (typeof v === "number") {
        const bounds =
          key === "amount"
            ? [limits?.commitments?.[intent.operation]?.maxAmount, ...policyLimits]
            : key === "retentionDays"
              ? [limits?.maxRetentionDays]
              : [];
        for (const bound of bounds.filter((v) => typeof v === "number"))
          for (const n of [bound + 0.01, bound * 10]) {
            const next = structuredClone(intent);
            let at = next.parameters;
            for (const part of trail) at = at[part];
            at[key] = n;
            push(`numeric:${[...trail, key].join(".")}`, next);
          }
      }
    }
  }
  numbers(intent.parameters);
  for (const action of actionTypes(context))
    if (action !== intent.action) push("action-type", { ...intent, action });
  for (const purpose of context.profile.purposes.map((p) => p.id))
    if (purpose !== intent.purpose) push("purpose", { ...intent, purpose });
  push("repeat-after-first-release", intent, { repeat: true });
  return proposals;
}
function saveProbe(context, point, kind, probe) {
  const a = context.a;
  a.proposals++;
  a[kind]++;
  a.outcomes[probe.outcome] = (a.outcomes[probe.outcome] ?? 0) + 1;
  const key = `${probe.outcome}/${probe.check ?? "none"}/${probe.reason}`;
  a.byCheckAndReason[key] = (a.byCheckAndReason[key] ?? 0) + 1;
  for (const id of Object.keys(properties)) a.propertyChecks[id]++;
  const mandateDecision = probe.gateMandateReading ?? probe.gateReading;
  const actualMandateReading = {
    permit: "allow",
    "approval-required": "approval",
    deny: "deny",
    indeterminate: "unknown",
  }[mandateDecision.outcome];
  const oracleUnknown = probe.referenceReading === "unknown";
  const disagreement = !oracleUnknown && actualMandateReading !== probe.referenceReading;
  if (probe.violations.length || disagreement || oracleUnknown) {
    const { state, mandate, record, ...reading } = probe;
    const cause = probe.violations
      .map((id) =>
        id === "A1-mandate"
          ? "The gate's ODRL action hierarchy and the oracle's exact action reading disagree; Claude must adjudicate."
          : id === "A2-item-terms"
            ? "The proposal carries an item whose independently read terms deny this recipient or purpose at release."
            : id === "A3-inbound-before-context"
              ? `No observed inbound admission for: ${state.items
                  .filter((i) => !state.admissionDigests.includes(i.digest))
                  .map((i) => i.claimType)
                  .join(", ")}.`
              : "The record obligation failed.",
      )
      .join(" ");
    const finding = {
      cause,
      point,
      kind,
      ...reading,
      trace: context.row.trace,
      reproduction: { mandateRef: digestOf(mandate ?? null), stateRef: digestOf(state), record },
    };
    a.reproductionStates[digestOf(state)] = state;
    a.reproductionMandates[digestOf(mandate ?? null)] = mandate ?? null;
    if (probe.violations.length) a.violations.push(finding);
    if (disagreement) a.evaluatorDisagreements.push(finding);
    if (oracleUnknown) a.unresolvedReadings.push(finding);
  }
}

class AdmissionComplete extends Error {}
async function forkRuntime(runtime, events, change = {}, stopAtDecision = true) {
  const at = runtime.now();
  const store = new MemoryStateStore();
  store.save(structuredClone(runtime.state));
  const ledger = new MemoryLedger();
  const options = {
    ...runtime.options,
    ...change,
    now: () => new Date(at),
    store,
    ledger,
    effects: change.effects ?? [],
    newId: (() => {
      let i = 0;
      return () => `urn:e0:fork:${++i}`;
    })(),
    gates: {
      ...runtime.options.gates,
      ...change.gates,
      sink: {
        emit: (e) => {
          events.push(e);
          if (stopAtDecision && e.part === "inbound-gate" && e.kind === "decision")
            throw new AdmissionComplete();
        },
      },
    },
  };
  const fork = await savedCreate.call(AgentRuntime, options);
  fork.mandate = runtime.mandate;
  fork.mandateFailure = runtime.mandateFailure;
  fork.inbound.authorityByConversation = new Map(runtime.inbound.authorityByConversation);
  return fork;
}
const savedCreate = AgentRuntime.create;
const savedReceive = AgentRuntime.prototype.receive;
const savedAdmit = AgentRuntime.prototype.admitStatements;
async function replay(runtime, input, direct, change = {}) {
  const events = [];
  const fork = await forkRuntime(runtime, events, change, !direct);
  const admittedClaims = [];
  const claimChecks = fork.inbound.claimChecks;
  fork.inbound.claimChecks = async function (...args) {
    const ok = await claimChecks.apply(this, args);
    if (ok && args[3] === "fitness") {
      const claim = args[4].get(args[0].value)?.claim;
      if (claim) admittedClaims.push({ id: claim.id, digest: digestOf(claim) });
    }
    return ok;
  };
  let result;
  try {
    result = direct
      ? await savedAdmit.call(fork, input.items, input.opts)
      : await savedReceive.call(fork, input.wire, input.meta);
  } catch (error) {
    if (!(error instanceof AdmissionComplete)) throw error;
  }
  const decision = events.findLast((e) => e.part === "inbound-gate" && e.kind === "decision");
  return {
    events,
    result,
    outcome:
      decision?.outcome ??
      (result?.disposition === "duplicate" ? "duplicate" : (result?.disposition ?? "no-decision")),
    reason: decision?.reason ?? result?.reason,
    admitted: admittedClaims,
    facts: [...fork.gateMemory.facts.values()],
    record: fork.ledger.entries(),
    state: fork.state,
  };
}
async function resign(value, keys, alter) {
  const body = decode(value);
  alter(body);
  const h = header(value);
  const key = keys.get(h.kid);
  if (!key) return undefined;
  return signStatement(key, h.typ, body);
}

async function runMutations(context, runtime, input, direct) {
  const b = context.b;
  const preState = structuredClone(runtime.state);
  const heldBefore = new Set(runtime.gateMemory.facts.keys());
  b.inbound++;
  const baseline = await replay(runtime, input, direct);
  const message = direct
    ? undefined
    : input.wire?.jws
      ? decode(input.wire.jws)
      : input.wire?.payload
        ? JSON.parse(input.wire.payload)
        : undefined;
  const evidence = direct
    ? input.items.map((i) => ({
        value: i.jws,
        format: i.format ?? "jws-compact",
        role: "credential",
      }))
    : (message?.evidence ?? []);
  const credentials = evidence
    .map((e, index) => ({ ...e, index }))
    .filter((e) => e.role === "credential" && e.format === "jws-compact");
  const reps = evidence
    .map((e, index) => ({ ...e, index }))
    .filter((e) => e.role === "representation");
  const keys = context.keys;
  const label = direct ? `statements:${b.inbound}` : (message?.id ?? `wire:${b.inbound}`);
  const cases = [];
  const add = (id, data, target = {}, change = {}, extra = {}) =>
    cases.push({ id, data, target, change, ...extra });
  async function changedMessage(id, alter, extra = {}) {
    if (!message || !input.wire.jws) return;
    const jws = await resign(input.wire.jws, keys, alter);
    if (jws) add(id, { ...input, wire: { ...input.wire, jws } }, {}, {}, extra);
  }
  async function changedEvidence(id, e, alter, extra = {}) {
    const value = await resign(e.value, keys, alter);
    if (!value) return;
    if (direct) {
      const data = structuredClone(input);
      data.items[e.index].jws = value;
      add(id, data, { claim: decode(value).id, digest: digestOf(decode(value)) }, {}, extra);
    } else
      await changedMessage(
        id,
        (m) => {
          m.evidence[e.index].value = value;
        },
        { target: { claim: decode(value).id, digest: digestOf(decode(value)) }, ...extra },
      );
  }
  if (direct)
    for (const e of credentials) {
      const body = decode(e.value),
        parts = e.value.split(".");
      const target = { claim: body.id };
      const addClaimWire = (id, jws) => {
        const data = structuredClone(input);
        data.items[e.index].jws = jws;
        add(id, data, target);
      };
      const bytes = Buffer.from(parts[2], "base64url");
      bytes[0] ^= 1;
      addClaimWire("signature-bytes", `${parts[0]}.${parts[1]}.${bytes.toString("base64url")}`);
      addClaimWire(
        "signed-body",
        `${parts[0]}.${Buffer.from(JSON.stringify({ ...body, e0Altered: true })).toString("base64url")}.${parts[2]}`,
      );
      const other = runtime.trust.data.keys.find(
        (k) => ["issuer", "party"].includes(k.role) && k.subject !== body.issuer && keys.has(k.kid),
      );
      if (other)
        addClaimWire(
          "known-signer",
          await signStatement(keys.get(other.kid), header(e.value).typ, body),
        );
      addClaimWire(
        "unknown-signer",
        await signStatement(await testKey("e0/fictional-unknown"), header(e.value).typ, body),
      );
    }
  async function changedStatus(id, configName, status, value, target = {}) {
    const config = runtime.options.gates?.[configName];
    if (!config || !status?.ref) return;
    const document = await config.resolver.resolve(status.ref);
    if (!document) return;
    const altered = await resign(document, keys, (c) => {
      c.entries[status.id] = value;
    });
    if (!altered) return;
    const resolver = {
      resolve: async (ref) => (ref === status.ref ? altered : config.resolver.resolve(ref)),
    };
    add(id, input, target, {
      gates: { ...runtime.options.gates, [configName]: { ...config, resolver } },
    });
  }
  if (input.wire?.jws) {
    const parts = input.wire.jws.split(".");
    const bytes = Buffer.from(parts[2], "base64url");
    bytes[0] ^= 1;
    add("signature-bytes", {
      ...input,
      wire: { ...input.wire, jws: `${parts[0]}.${parts[1]}.${bytes.toString("base64url")}` },
    });
    const altered = structuredClone(message);
    altered.body = { ...altered.body, e0Altered: true };
    add("signed-body", {
      ...input,
      wire: {
        ...input.wire,
        jws: `${parts[0]}.${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${parts[2]}`,
      },
    });
    const other = runtime.trust.data.keys.find(
      (k) => k.role === "actor" && k.subject !== message.from.actor && keys.has(k.kid),
    );
    if (other)
      add("known-signer", {
        ...input,
        wire: {
          ...input.wire,
          jws: await signStatement(keys.get(other.kid), header(input.wire.jws).typ, message),
        },
      });
    const unknown = await testKey("e0/fictional-unknown");
    add("unknown-signer", {
      ...input,
      wire: {
        ...input.wire,
        jws: await signStatement(unknown, header(input.wire.jws).typ, message),
      },
    });
    await changedMessage("future-timestamp", (m) => {
      m.createdAt = new Date(
        Date.parse(runtime.now()) + runtime.limits.maxClockSkewMs + 1000,
      ).toISOString();
      m.expiresAt = new Date(Date.parse(m.createdAt) + 60000).toISOString();
    });
    const previous = Object.values(runtime.state.recordMessages).find(
      (v) => v.direction === "in" && decode(v.jws).conversation === message.conversation,
    );
    if (previous)
      add("replay-earlier", {
        ...input,
        wire: { format: "awp-jws-compact/0.1", jws: previous.jws },
      });
  }
  for (const e of credentials) {
    const claim = decode(e.value);
    const rule = context.profile.claims.find((r) => r.kind === claim.claimType);
    const target = { claim: claim.id, digest: digestOf(claim) };
    for (const [id, status] of [
      ["issuer-withdrawn", "withdrawn"],
      ["issuer-suspended", "suspended"],
    ]) {
      const gates = runtime.options.gates;
      const resolver = gates?.resolver;
      // Only a scenario with a register entry has issuer status to change.
      const root = context.world.trust.root;
      const entry = root?.delegates
        .flatMap((d) => d.entries)
        .find(
          (x) =>
            x.party === claim.issuer && (!x.claimTypes || x.claimTypes.includes(claim.claimType)),
        );
      if (entry && resolver) {
        // Resolver is re-created with the identical store and only the selected entry altered.
        const changedRoot = structuredClone(root);
        for (const d of changedRoot.delegates)
          for (const x of d.entries) if (x.id === entry.id) x.status = status;
        const changedResolver = new resolver.constructor({
          ...resolver.opts,
          root: changedRoot,
          trust: runtime.trust,
        });
        add(id, input, target, { gates: { ...gates, resolver: changedResolver } });
      }
    }
    if (claim.status)
      await changedStatus("issuer-withdrawn", "organizations", claim.status, "withdrawn", {
        claim: claim.id,
        digest: digestOf(claim),
      });
    if (claim.validUntil)
      await changedEvidence("credential-expired", e, (c) => {
        c.validUntil = "2020-01-01T00:00:00.000Z";
      });
    if (claim.validFrom)
      await changedEvidence("credential-not-yet-valid", e, (c) => {
        c.validFrom = "2099-01-01T00:00:00.000Z";
      });
    if (rule && claim.asOf)
      await changedEvidence("stale-timestamp", e, (c) => {
        c.asOf = new Date(
          Date.parse(runtime.now()) - (rule.maxAgeDays + 1) * 86400000,
        ).toISOString();
      });
    for (const id of ["source-removed", "source-other-claim"]) {
      const data = structuredClone(runtime.trust.data);
      data.sourceAuthority = data.sourceAuthority.flatMap((r) =>
        r.source !== claim.issuer ||
        !r.claimTypes.some(
          (t) =>
            t === claim.claimType ||
            (t.endsWith(".*") && claim.claimType.startsWith(t.slice(0, -1))),
        )
          ? [r]
          : id === "source-removed"
            ? []
            : [{ ...r, claimTypes: ["e0.different-claim"] }],
      );
      const trust = await TrustStore.load(data);
      const old = runtime.options.gates;
      const resolver = old?.resolver;
      const root = structuredClone(resolver?.opts.root);
      if (root)
        for (const d of root.delegates)
          d.entries = d.entries.flatMap((r) =>
            r.party !== claim.issuer
              ? [r]
              : id === "source-removed"
                ? []
                : [{ ...r, claimTypes: ["e0.different-claim"] }],
          );
      const gates = {
        ...old,
        resolver: resolver
          ? new resolver.constructor({ ...resolver.opts, trust, root })
          : undefined,
      };
      add(id, input, target, { trust, gates });
    }
    if (claim.terms) {
      await changedEvidence("terms-removed", e, (c) => {
        delete c.terms;
      });
      await changedEvidence("terms-forbid-purpose", e, (c) => {
        c.terms.policy.prohibitions ??= [];
        c.terms.policy.prohibitions.push({
          type: "prohibition",
          action: "use",
          target: c.id,
          constraints: [
            {
              leftOperand: "purpose",
              operator: "eq",
              rightOperand: direct
                ? input.opts.purpose
                : (runtime.inbound.deps.agreementTerms(message.conversation)?.purpose ??
                  message.body.purpose ??
                  (message.kind === "deliver"
                    ? runtime.inbound.deps.requestPurpose?.(message.body.ref)
                    : undefined) ??
                  runtime.purposeOf(message.conversation) ??
                  "urn:e0:purpose"),
            },
          ],
        });
      });
      if (runtime.gateMemory.facts.has(claim.id))
        await changedEvidence("terms-after-acceptance", e, (c) => {
          c.terms.policy.id = "urn:e0:changed-terms";
        });
    }
    await changedEvidence("claim-shape", e, (c) => {
      c.claimType = 7;
    });
    const required = runtime.options.gates?.actionClaims?.some(
      (r) =>
        r.action ===
          (direct
            ? input.opts.operation
            : (message.body.operation?.id ??
              runtime.state.conversations[message.conversation]?.operation?.id)) &&
        r.claims.includes(claim.claimType),
    );
    if (required && !direct)
      await changedMessage(
        "required-claim-removed",
        (m) => {
          m.evidence.splice(e.index, 1);
        },
        { target: { claim: claim.id, removed: true } },
      );
    if (claim.derivation) {
      await changedEvidence("derived-rule-digest", e, (c) => {
        c.derivation.ruleDigest = "sha-256:e0-changed";
      });
      if (claim.derivation.inputs?.length)
        await changedEvidence("derived-input-issuer", e, (c) => {
          c.derivation.inputs[0].issuer = "urn:e0:unknown-issuer";
        });
      await changedEvidence("derived-assurance", e, (c) => {
        c.derivation.assurance = "proved";
      });
    }
  }
  if (message && reps.length) {
    await changedMessage("mandate-missing", (m) => {
      m.evidence = m.evidence.filter((e) => e.role !== "representation");
    });
    for (const e of reps) {
      if (e.format === "jws-compact") {
        await changedEvidence("mandate-expired", e, (c) => {
          c.validUntil = "2020-01-01T00:00:00.000Z";
        });
        await changedEvidence("mandate-other-key", e, (c) => {
          c.actorKid = "urn:e0:different-key";
        });
        await changedEvidence("mandate-scope", e, (c) => {
          c.operations = ["urn:e0:different-operation"];
        });
        b.unspecified.push({
          message: label,
          mutation: "mandate-withdrawn",
          readings: unspecified["mandate-withdrawn"],
          applicability: "The pinned representation credential has no status reference.",
        });
      } else if (e.format === "organization-mandate+jws") {
        const credential = decode(e.value);
        await changedEvidence("mandate-expired", e, (c) => {
          c.validUntil = "2020-01-01T00:00:00.000Z";
        });
        await changedEvidence("mandate-other-key", e, (c) => {
          c.subjectKey = "urn:e0:other-key";
        });
        await changedEvidence("mandate-scope", e, (c) => {
          c.actions = ["e0-other-action"];
        });
        await changedStatus("mandate-withdrawn", "organizations", credential.status, "withdrawn");
      } else if (e.format === "mandate-chain+jws") {
        const chains = JSON.parse(e.value);
        if (chains.some((c) => c.length > 1)) {
          const changed = structuredClone(chains);
          for (const chain of changed)
            if (chain.length > 1) {
              chain[1] = await resign(chain[1], keys, (c) => {
                c.scope.purposes.push("urn:e0:wider-purpose");
              });
              break;
            }
          await changedMessage("chain-widened", (m) => {
            m.evidence[e.index].value = JSON.stringify(changed);
          });
        }
      }
    }
  }
  for (const c of cases) {
    const row = mutations.find((r) => r.id === c.id);
    const observed = await replay(runtime, c.data, direct, c.change);
    const expected = { ...row };
    const target = c.target ?? {};
    const targetCheck = observed.events.findLast(
      (e) =>
        e.kind === "check" &&
        e.check === row.check &&
        (e.verdict !== "pass" || row.verdict === "pass"),
    );
    const failedCheck = observed.events.find(
      (e) => e.kind === "check" && !["pass", "not-applicable"].includes(e.verdict),
    );
    const actual = {
      outcome: observed.outcome,
      check: failedCheck?.check ?? targetCheck?.check,
      verdict: failedCheck?.verdict ?? targetCheck?.verdict,
      reason: observed.reason ?? failedCheck?.reason ?? targetCheck?.reason,
    };
    if (c.id === "replay-earlier" && observed.outcome === "duplicate")
      Object.assign(actual, { check: "integrity", verdict: "pass", reason: "duplicate" });
    const standing = target.removed
      ? observed.outcome === "admit"
      : target.claim
        ? observed.admitted.some(
            (f) => f.id === target.claim && (!target.digest || f.digest === target.digest),
          ) && !target.removed
        : observed.outcome === "admit";
    const baselineStanding = target.claim
      ? baseline.admitted.some((f) => f.id === target.claim)
      : baseline.outcome === "admit";
    const ambiguous =
      target.removed && heldBefore.has(target.claim)
        ? [
            "A required claim must accompany each new message, so the receiver should ask for more.",
            "The same accepted, in-scope claim is already held, so it can satisfy the operation without re-sending it.",
          ]
        : c.id === "mandate-withdrawn" && runtime.options.gates?.organizations
          ? undefined
          : unspecified[c.id];
    const falseAdmit =
      !ambiguous &&
      row.verdict !== "pass" &&
      baselineStanding &&
      standing &&
      observed.outcome === "admit";
    const verdictMatches = actual.verdict === row.verdict;
    const reasonMatches = actual.reason === row.reason;
    const checkMatches = actual.check === row.check;
    const result = {
      message: label,
      mutation: c.id,
      target,
      targetHeldBefore: heldBefore.has(target.claim),
      clause: row.clause,
      expected: ambiguous ? null : expected,
      actual,
      baseline: { outcome: baseline.outcome, reason: baseline.reason },
      falseAdmit,
      cause: falseAdmit
        ? c.id === "required-claim-removed"
          ? "The required credential was removed but the inbound envelope retained admission."
          : "The changed target was admitted again with the same factual standing."
        : undefined,
      verdictMatches,
      reasonMatches,
      checkMatches,
      trace: context.row.trace,
    };
    b.tried++;
    b.byMutation[c.id] = (b.byMutation[c.id] ?? 0) + 1;
    b.results.push(result);
    if (ambiguous) b.unspecified.push({ ...result, readings: ambiguous });
    else {
      b.specified++;
      if (falseAdmit)
        b.falseAdmits.push({
          ...result,
          reproduction: {
            input: c.data,
            preState,
            trust: runtime.trust.data,
            record: observed.record,
            events: observed.events,
          },
        });
      if (!reasonMatches) b.wrongReasons++;
      if (verdictMatches && !checkMatches) b.wrongChecks++;
      if (verdictMatches && reasonMatches && checkMatches) b.exact++;
    }
  }
  for (const row of mutations)
    if (!cases.some((c) => c.id === row.id))
      b.notApplicable[row.id] = (b.notApplicable[row.id] ?? 0) + 1;
  if (!direct && input.wire?.jws)
    context.receives.push({
      runtime,
      before: structuredClone(runtime.state),
      input: structuredClone(input),
      message,
      record: recordOf(runtime),
    });
}

function snapshot(runtime) {
  const memory = cloneMemory(runtime.gateMemory);
  admissions.set(memory, new Set(admissions.get(runtime.gateMemory) ?? []));
  return {
    state: structuredClone(runtime.state),
    at: runtime.now(),
    carriage: runtime.carriage,
    recordReleaseDigest: runtime.recordReleaseDigest,
    verifiedEmailPins: structuredClone(runtime.verifiedEmailPins),
    proposalOrigin: structuredClone(runtime.proposalOrigin),
    gateMemory: memory,
    memoryAliases: memoryAliases(runtime.gateMemory, runtime.state),
    mandate: runtime.mandate,
    authority: new Map(runtime.inbound.authorityByConversation),
    shown: new Set(shown.get(runtime) ?? []),
    record: recordOf(runtime),
    singleUseStates: Object.fromEntries(
      Object.entries(runtime.options.gates?.singleUse?.registers ?? {}).map(([id, r]) => [
        id,
        r.options.store.load(),
      ]),
    ),
  };
}
function atSnapshot(runtime, saved, work) {
  const before = {
    state: runtime.state,
    clock: runtime.clock,
    carriage: runtime.carriage,
    recordReleaseDigest: runtime.recordReleaseDigest,
    verifiedEmailPins: runtime.verifiedEmailPins,
    proposalOrigin: runtime.proposalOrigin,
    gateMemory: runtime.gateMemory,
    mandate: runtime.mandate,
    authority: runtime.inbound.authorityByConversation,
    shown: shown.get(runtime),
  };
  runtime.clock = () => new Date(saved.at);
  runtime.carriage = saved.carriage;
  runtime.recordReleaseDigest = saved.recordReleaseDigest;
  runtime.verifiedEmailPins = structuredClone(saved.verifiedEmailPins);
  runtime.proposalOrigin = structuredClone(saved.proposalOrigin);
  runtime.state = structuredClone(saved.state);
  runtime.gateMemory = cloneMemory(saved.gateMemory, runtime.state, saved.memoryAliases);
  runtime.mandate = saved.mandate;
  runtime.inbound.authorityByConversation = saved.authority;
  shown.set(runtime, saved.shown);
  const done = () => {
    runtime.clock = before.clock;
    runtime.carriage = before.carriage;
    runtime.recordReleaseDigest = before.recordReleaseDigest;
    runtime.verifiedEmailPins = before.verifiedEmailPins;
    runtime.proposalOrigin = before.proposalOrigin;
    runtime.state = before.state;
    runtime.gateMemory = before.gateMemory;
    runtime.mandate = before.mandate;
    runtime.inbound.authorityByConversation = before.authority;
    shown.set(runtime, before.shown);
  };
  try {
    const result = work();
    if (result instanceof Promise) return result.finally(done);
    done();
    return result;
  } catch (error) {
    done();
    throw error;
  }
}

function forbiddenPurpose(terms) {
  for (const rule of terms?.policy?.prohibitions ?? []) {
    if (!["use", "distribute"].includes(rule.action)) continue;
    for (const c of rule.constraints ?? [])
      if (c.leftOperand === "purpose" && ["eq", "isAnyOf"].includes(c.operator))
        return String(Array.isArray(c.rightOperand) ? c.rightOperand[0] : c.rightOperand);
  }
  const permissions = terms?.policy?.permissions ?? [];
  if (
    permissions.length &&
    permissions.every((r) =>
      r.constraints?.some(
        (c) => c.leftOperand === "purpose" && ["eq", "isAnyOf"].includes(c.operator),
      ),
    )
  )
    return "urn:e0:outside-terms";
  for (const input of terms?.inherited ?? []) {
    const purpose = forbiddenPurpose(input.terms);
    if (purpose) return purpose;
  }
  return undefined;
}
function appendRecords(prefix, entries) {
  const ledger = new MemoryLedger();
  for (const e of [...prefix, ...entries]) ledger.append(e.record, e.at);
  return ledger.entries();
}
async function transportFault(context, culprit, kind) {
  let purpose;
  const transfer = context.receives.find((c) => {
    if (c.sender !== culprit || !c.senderSnapshot) return false;
    if (kind === "after-withdrawal") return true;
    for (const e of c.message.evidence ?? []) {
      if (e.role !== "credential" || e.format !== "jws-compact") continue;
      const claim = decode(e.value);
      const held = c.senderSnapshot.gateMemory.facts.get(claim.id);
      const forbidden = held && forbiddenPurpose(claim.terms);
      if (forbidden) {
        purpose = forbidden;
        return true;
      }
    }
    return false;
  });
  if (!transfer) return undefined;
  const recordA = structuredClone(transfer.senderSnapshot.record);
  if (kind === "after-withdrawal") {
    const events = [];
    const entries = await atSnapshot(culprit, transfer.senderSnapshot, async () => {
      const fork = await forkRuntime(culprit, events, {}, false);
      await fork.revokeMandate();
      return fork.ledger.entries();
    });
    recordA.entries = appendRecords(recordA.entries, entries);
  }
  const changed = laterMessage(transfer.message, transfer.senderSnapshot.at, purpose);
  const oldWire = transfer.input.wire;
  const jws = await signStatement(
    context.keys.get(header(oldWire.jws).kid),
    header(oldWire.jws).typ,
    changed,
  );
  const input = { ...transfer.input, wire: { ...oldWire, jws } };
  const receiver = await atSnapshot(transfer.runtime, transfer.receiverSnapshot, () =>
    replay(transfer.runtime, input, false),
  );
  const recordB = structuredClone(transfer.receiverSnapshot.record);
  recordB.entries = appendRecords(recordB.entries, receiver.record);
  recordA.messages.push({ direction: "out", jws });
  recordB.messages.push({ direction: "in", jws });
  return {
    recordA,
    recordB,
    observation: {
      message: changed.id,
      purpose,
      senderGateBypassed: true,
      receiverOutcome: receiver.outcome,
      receiverReason: receiver.reason,
    },
  };
}

async function runFaults(context) {
  await serviceFaults(context);
  const transfers = context.receives.filter(
    (x) =>
      x.message.from.actor &&
      x.message.to?.actor &&
      (x.message.kind === "propose" ||
        x.message.kind === "accept" ||
        x.message.kind === "deliver" ||
        (x.message.evidence ?? []).some((e) => e.role === "credential") ||
        x.message.content?.length),
  );
  if (!transfers.length && !context.services.length) {
    context.c.ineligible = "No bilateral commitment or data transfer was emitted on this path.";
    return;
  }
  const parties = [
    ...new Set(transfers.flatMap((t) => [t.message.from.actor, t.message.to.actor])),
  ];
  for (const plan of generateFaults(parties)) {
    const transfer = transfers.find(
      (t) => t.message.from.actor === plan.party || t.message.to.actor === plan.party,
    );
    const sender = transfer.sender;
    const receiver = transfer.runtime;
    if (!sender) continue;
    const culprit = plan.party === sender.identity.actor ? sender : receiver;
    const culpritSnapshot =
      culprit === sender ? transfer.senderSnapshot : transfer.receiverSnapshot;
    const peerSnapshot = culprit === sender ? transfer.receiverSnapshot : transfer.senderSnapshot;
    let recordA = structuredClone(culpritSnapshot.record);
    let recordB = structuredClone(peerSnapshot.record);
    let observation;
    let receiverRefused = false;
    let notApplicable;
    let expectedClause;
    if (plan.kind === "after-withdrawal" || plan.kind === "outside-purpose") {
      const result = await transportFault(context, culprit, plan.kind);
      if (!result)
        notApplicable =
          "No later signed outbound transfer by this party carries a held item with a forbidden purpose, or no signed outbound message exists.";
      else {
        recordA = result.recordA;
        recordB = result.recordB;
        observation = result.observation;
        receiverRefused = result.observation.receiverOutcome !== "admit";
      }
      expectedClause = plan.kind === "after-withdrawal" ? "CORE-OUT-10" : "CORE-OUT-5";
    } else if (plan.kind === "withhold-receipt") {
      const receipt = context.receives.find(
        (t) => t.sender === culprit && t.message.kind === "receipt" && t.senderSnapshot,
      );
      if (!receipt)
        notApplicable = "This party emitted no receipt that can be withheld on this path.";
      else {
        recordA = structuredClone(receipt.senderSnapshot.record);
        recordB = structuredClone(receipt.receiverSnapshot.record);
        observation = { receiptSuppressed: receipt.message.id, transmissionDropped: true };
        expectedClause = "AC-1";
      }
    } else if (plan.kind === "deny-acknowledged") {
      const receipt = context.receives.find(
        (t) => t.sender === culprit && t.message.kind === "receipt" && t.senderSnapshot,
      );
      if (!receipt)
        notApplicable = "This party emitted no signed receipt that could be contradicted.";
      else {
        const ack = receipt.message;
        const denial = laterMessage(ack, receipt.senderSnapshot.at);
        denial.body.observed = {
          ...(ack.body.observed ?? {}),
          received: false,
          message: ack.inReplyTo ?? ack.body.ref,
        };
        const wire = receipt.input.wire;
        const jws = await signStatement(
          context.keys.get(header(wire.jws).kid),
          header(wire.jws).typ,
          denial,
        );
        const receivedAck = await atSnapshot(receipt.runtime, receipt.receiverSnapshot, () =>
          replay(receipt.runtime, receipt.input, false),
        );
        const afterAck = { ...receipt.receiverSnapshot, state: receivedAck.state };
        const receivedDenial = await atSnapshot(receipt.runtime, afterAck, () =>
          replay(receipt.runtime, { ...receipt.input, wire: { ...wire, jws } }, false),
        );
        recordA = structuredClone(receipt.senderSnapshot.record);
        recordB = structuredClone(receipt.receiverSnapshot.record);
        recordB.entries = appendRecords(recordB.entries, [
          ...receivedAck.record,
          ...receivedDenial.record,
        ]);
        recordA.messages.push({ direction: "out", jws });
        recordB.messages.push({ direction: "in", jws: wire.jws }, { direction: "in", jws });
        observation = {
          acknowledged: ack.id,
          denial: denial.id,
          receiverOutcome: receivedDenial.outcome,
        };
        receiverRefused = receivedDenial.outcome !== "admit";
        expectedClause = "AC-2";
      }
    } else {
      // Change exactly the culpable sender's signed commitment. Reverse roles only where a transfer exists.
      const candidates = transfers.filter(
        (t) =>
          t.message.from.actor === culprit.identity.actor &&
          ["propose", "accept"].includes(t.message.kind),
      );
      const outgoing =
        plan.kind === "change-terms"
          ? candidates.find((t) =>
              t.senderSnapshot.record.entries.some(
                (e) => e.record.type === "approval" && e.record.decision === "approve",
              ),
            )
          : candidates[0];
      if (!outgoing)
        notApplicable =
          "This party emitted no applicable structured commitment after approval on the path.";
      else {
        const changed = laterMessage(
          changeCommitment(outgoing.message),
          outgoing.senderSnapshot.at,
        );
        const jws = await signStatement(
          context.keys.get(header(outgoing.input.wire.jws).kid),
          header(outgoing.input.wire.jws).typ,
          changed,
        );
        const data = { ...outgoing.input, wire: { ...outgoing.input.wire, jws } };
        const result = await atSnapshot(outgoing.runtime, outgoing.receiverSnapshot, () =>
          replay(outgoing.runtime, data, false),
        );
        recordA = structuredClone(outgoing.senderSnapshot.record);
        recordB = structuredClone(outgoing.receiverSnapshot.record);
        recordA.messages.push({ direction: "out", jws });
        recordB.messages.push({ direction: "in", jws });
        const ledger = new MemoryLedger();
        for (const e of recordB.entries) ledger.append(e.record, e.at);
        for (const e of result.record) ledger.append(e.record, e.at);
        recordB.entries = ledger.entries();
        observation = {
          message: changed.id,
          changedBody: changed.body,
          outcome: result.outcome,
          reason: result.reason,
        };
        receiverRefused = result.outcome !== "admit";
        expectedClause = "CORE-OUT-7";
      }
    }
    if (notApplicable) {
      context.c.notApplicable.push({
        party: culprit.identity.party,
        kind: plan.kind,
        reason: notApplicable,
      });
      continue;
    }
    const attribution = whoWasAtFault(recordA, recordB);
    const correct =
      attribution.party === culprit.identity.party && attribution.clause === expectedClause;
    context.c.results.push({
      injected: {
        party: culprit.identity.party,
        actor: culprit.identity.actor,
        kind: plan.kind,
        clause: expectedClause,
      },
      observation,
      receiverRefused,
      attribution,
      correct,
      recordA,
      recordB,
      trace: context.row.trace,
    });
  }
}

original(AgentRuntime, "create", (previous) => async (options) => {
  const runtime = await previous.call(AgentRuntime, options);
  if (!probing) {
    while (contexts[creationIndex]?.remaining === 0) creationIndex++;
    current = contexts[creationIndex];
    if (!current) throw new Error("runtime creation did not match manifest paths");
    current.remaining--;
    contextOf.set(runtime, current);
    current.runtimes.push(runtime);
    actorRuntime.set(runtime.identity.actor, runtime);
    memoryOwner.set(runtime.gateMemory, runtime);
    admissions.set(runtime.gateMemory, new Set());
    shown.set(runtime, new Set());
  }
  return runtime;
});
original(
  InboundGate.prototype,
  "storeEvent",
  (previous) =>
    function (claim, ...rest) {
      if (!probing) admissions.get(this.deps.memory)?.add(digestOf(claim));
      return previous.call(this, claim, ...rest);
    },
);
original(
  Admission.prototype,
  "complete",
  (previous) =>
    async function (conv, msg) {
      const result = await previous.call(this, conv, msg);
      if (!probing && result.ok && this.outcome === "admit") {
        const seen = admissions.get(this.deps.memory);
        seen?.add(digestOf(msg));
        for (const part of msg.content ?? []) seen?.add(part.digest);
      }
      return result;
    },
);
original(
  GateMemory.prototype,
  "enter",
  (previous) =>
    function (task, item) {
      const seen = admissions.get(this);
      if (!probing && item.kind === "reading" && seen?.has(item.statement?.originalDigest))
        seen.add(item.digest);
      return previous.call(this, task, item);
    },
);
original(
  AgentRuntime.prototype,
  "park",
  (previous) =>
    function (...args) {
      const result = previous.apply(this, args);
      if (!probing) shown.get(this)?.add(result.actionDigest);
      return result;
    },
);
original(
  AgentRuntime.prototype,
  "authorise",
  (previous) =>
    function (intent, quiet) {
      const context = contextOf.get(this);
      let clonedDecision;
      if (!probing && context && !quiet && !this.resuming) {
        probing = true;
        try {
          clonedDecision = probeOutbound(this, intent).gateReading;
          const point = context.points.length + 1;
          context.points.push({
            runtime: this,
            intent: structuredClone(intent),
            snapshot: snapshot(this),
          });
          for (const candidate of attackers(context, this, intent))
            saveProbe(context, point, "attacker", {
              ...probeOutbound(this, candidate.proposal, candidate.options),
              mutation: candidate.mutation,
            });
        } finally {
          probing = false;
        }
      }
      const actual = previous.call(this, intent, quiet);
      if (clonedDecision) {
        if (digestOf(actual) !== digestOf(clonedDecision))
          throw new Error(
            "E0 cloned outbound decision differs from the unmodified scripted proposal",
          );
        context.a.cloneComparisons++;
      }
      return actual;
    },
);
original(
  AgentRuntime.prototype,
  "receive",
  (previous) =>
    async function (wire, meta = {}) {
      if (!probing && contextOf.has(this)) {
        probing = true;
        try {
          const context = contextOf.get(this);
          const before = context.receives.length;
          await runMutations(context, this, { wire, meta }, false);
          const captured = context.receives[before];
          if (captured) {
            captured.receiverSnapshot = snapshot(this);
            captured.sender = actorRuntime.get(captured.message.from.actor);
            if (captured.sender) captured.senderSnapshot = snapshot(captured.sender);
          }
        } finally {
          probing = false;
        }
      }
      return previous.call(this, wire, meta);
    },
);
original(
  AgentRuntime.prototype,
  "receiveEmail",
  (previous) =>
    async function (input) {
      const context = contextOf.get(this);
      if (!probing && context) {
        context.b.inbound++;
        context.b.unsignedEmail = (context.b.unsignedEmail ?? 0) + 1;
        for (const row of mutations)
          context.b.notApplicable[row.id] = (context.b.notApplicable[row.id] ?? 0) + 1;
      }
      const result = await previous.call(this, input);
      if (!probing && result.ok) {
        const content = this.gateMemory
          .context(this.options.gates?.taskId ?? "*")
          .find((i) => i.id === result.part?.id);
        if (content) admissions.get(this.gateMemory)?.add(content.digest);
        // The email entrypoint returns its content part directly in this package version.
        for (const item of this.gateMemory.context(this.options.gates?.taskId ?? "*"))
          if (
            item.method === "unsigned-prose" &&
            item.source === input.from &&
            item.statement?.bytes === input.text
          )
            admissions.get(this.gateMemory)?.add(item.digest);
      }
      return result;
    },
);
original(
  AgentRuntime.prototype,
  "admitStatements",
  (previous) =>
    async function (items, opts) {
      if (!probing && contextOf.has(this)) {
        probing = true;
        try {
          await runMutations(contextOf.get(this), this, { items, opts }, true);
        } finally {
          probing = false;
        }
      }
      return previous.call(this, items, opts);
    },
);

async function runAtomicRepeats(context) {
  for (const [index, point] of context.points.entries()) {
    const config = point.runtime.options.gates?.singleUse;
    if (!config?.actions.some((a) => a.action === point.intent.action)) continue;
    await atSnapshot(point.runtime, point.snapshot, async () => {
      const events = [],
        registers = {};
      for (const [id, original] of Object.entries(config.registers)) {
        const store = new MemoryStateStore();
        store.save(point.snapshot.singleUseStates[id]);
        registers[id] = new original.constructor({
          ...original.options,
          now: () => point.snapshot.at,
          store,
          ledger: new MemoryLedger(),
          sink: (e) => events.push(e),
        });
      }
      let executed = 0;
      let writeAhead = true;
      const fork = await forkRuntime(
        point.runtime,
        events,
        {
          gates: { ...point.runtime.options.gates, singleUse: { ...config, registers } },
          effects: [
            {
              id: "urn:e0:atomic-effect",
              bindsParameters: true,
              execute: async () => {
                writeAhead &&= fork.ledger
                  .entries()
                  .some(
                    (e) =>
                      e.record.type === "authorisation-decision" &&
                      e.record.actionDigest === digestOf(point.intent),
                  );
                executed++;
                return { conclusion: "completed", observed: { fictional: true } };
              },
              reconcile: async () => ({
                conclusion: "not-executed",
                reason: "fictional isolated adapter",
              }),
            },
          ],
        },
        false,
      );
      const run = async (key) =>
        fork.runTask({
          taskId: key,
          kind: "e0-single-use-repeat",
          plan: {
            adapter: "urn:e0:atomic-effect",
            key,
            activityType: "urn:e0:single-use-repeat",
            intent: point.intent,
            params: point.intent.parameters,
          },
        });
      await run("urn:e0:atomic-first");
      const afterFirst = executed;
      const before = fork.ledger.entries().length;
      await run("urn:e0:atomic-second");
      const entries = fork.ledger.entries().slice(before);
      const terminal = events.findLast((e) => e.kind === "decision" && e.part === "outbound-gate");
      const check = events.findLast(
        (e) => e.kind === "check" && !["pass", "not-applicable"].includes(e.verdict),
      );
      const authorisation = [...entries]
        .reverse()
        .find((e) => e.record.type === "authorisation-decision")?.record;
      if (!authorisation) throw new Error("atomic repeat produced no authorisation record");
      const outcome = terminal?.outcome ?? "stop";
      const state = stateOf(point.runtime, point.intent),
        mandate = point.runtime.mandate?.mandate;
      const input = {
        mandate,
        state,
        proposal: point.intent,
        decision: { outcome, authorisation },
        record: {
          beforeEffect: writeAhead,
          decisions: entries
            .filter((e) => e.record.type === "authorisation-decision")
            .map((e) => e.record),
          releases: entries
            .filter((e) => e.record.type === "check-verdict" && e.record.verdict === "fail")
            .map((e) => ({ digest: e.record.subject, outcome: "stop" })),
        },
      };
      const probe = {
        proposal: point.intent,
        outcome,
        check: check?.check,
        reason: terminal?.reason ?? check?.reason,
        gateReading: authorisation,
        referenceReading: readMandate(mandate, state, point.intent),
        termsReadings: [],
        violations: Object.entries(properties)
          .filter(([, f]) => !f(input))
          .map(([id]) => id),
        state,
        mandate,
        record: entries,
        events,
        mutation: "repeat-after-atomic-redemption",
      };
      saveProbe(context, index + 1, "attacker", probe);
      context.a.atomicRepeats.push({
        point: index + 1,
        firstExecutions: afterFirst,
        totalExecutions: executed,
        secondOutcome: outcome,
        reason: probe.reason,
        record: fork.ledger.entries(),
        registerRecords: Object.fromEntries(
          Object.entries(registers).map(([id, r]) => [id, r.options.ledger.entries()]),
        ),
      });
      context.b.unspecified.push({
        mutation: "single-use-twice",
        readings: unspecified["single-use-twice"],
        applicability:
          "Consumption is an outbound atomic register operation, not inbound credential admission.",
        atomicTrial: {
          firstExecutions: afterFirst,
          totalExecutions: executed,
          secondOutcome: outcome,
          reason: probe.reason,
        },
      });
    });
  }
}

// Capability services have their own gates. Replay their real entrypoints with fresh stores.
function serviceRecord(service, messages = []) {
  return {
    party: service.options.identity,
    actor: service.options.identity,
    entries: structuredClone(service.options.ledger.entries()),
    messages,
  };
}
function cloneService(service, events, storeSnapshot, prefix = [], at, mandateActiveByActor) {
  const ledger = new MemoryLedger();
  for (const e of prefix) ledger.append(e.record, e.at);
  const store = new MemoryStateStore();
  if (storeSnapshot) store.save(structuredClone(storeSnapshot));
  return new service.constructor({
    ...service.options,
    now: () => at ?? service.options.now(),
    ...(service.options.mandateActive
      ? { mandateActive: (actor) => mandateActiveByActor?.[actor] === true }
      : {}),
    store,
    ledger,
    sink: (e) => events.push(e),
  });
}
async function serviceReplay(capture, args) {
  const events = [];
  const service = cloneService(
    capture.service,
    events,
    capture.store,
    capture.record.entries,
    capture.at,
    capture.mandateActiveByActor,
  );
  const result = await capture.method.call(service, ...args);
  return {
    result,
    events,
    record: serviceRecord(service),
    outcome: result.ok ? "admit" : "refuse",
  };
}
async function serviceMutations(context, capture) {
  const b = context.b;
  b.inbound++;
  b.serviceInbound = (b.serviceInbound ?? 0) + 1;
  const baseline = await serviceReplay(capture, capture.args);
  const jws = capture.args[capture.jwsIndex],
    msg = decode(jws),
    h = header(jws);
  const trials = [];
  const add = (id, value) => {
    const args = structuredClone(capture.args);
    args[capture.jwsIndex] = value;
    trials.push({ id, args });
  };
  const parts = jws.split(".");
  const bytes = Buffer.from(parts[2], "base64url");
  bytes[0] ^= 1;
  add("signature-bytes", `${parts[0]}.${parts[1]}.${bytes.toString("base64url")}`);
  add(
    "signed-body",
    `${parts[0]}.${Buffer.from(JSON.stringify({ ...msg, at: "2020-01-01T00:00:00.000Z" })).toString("base64url")}.${parts[2]}`,
  );
  add("unknown-signer", await signStatement(await testKey("e0/fictional-unknown"), h.typ, msg));
  const other = capture.service.options.trust.data.keys.find(
    (k) => k.role === "actor" && k.subject !== msg.actor && context.keys.has(k.kid),
  );
  if (other) add("known-signer", await signStatement(context.keys.get(other.kid), h.typ, msg));
  if (msg.at)
    add(
      "future-timestamp",
      await resign(jws, context.keys, (m) => {
        m.at = "2099-01-01T00:00:00.000Z";
      }),
    );
  if (msg.representation) {
    add(
      "mandate-missing",
      await resign(jws, context.keys, (m) => {
        m.representation = "";
      }),
    );
    for (const [id, alter] of [
      [
        "mandate-expired",
        (c) => {
          c.validUntil = "2020-01-01T00:00:00.000Z";
        },
      ],
      [
        "mandate-other-key",
        (c) => {
          c.actorKid = "urn:e0:other-key";
        },
      ],
      [
        "mandate-scope",
        (c) => {
          c.operations = ["urn:e0:other-operation"];
        },
      ],
    ]) {
      const rep = await resign(msg.representation, context.keys, alter);
      if (rep)
        add(
          id,
          await resign(jws, context.keys, (m) => {
            m.representation = rep;
          }),
        );
    }
  }
  for (const trial of trials.filter((t) => t.args[capture.jwsIndex])) {
    const expected = mutations.find((m) => m.id === trial.id);
    const observed = await serviceReplay(capture, trial.args);
    const check = observed.events.find(
      (e) => e.kind === "check" && !["pass", "not-applicable"].includes(e.verdict),
    );
    const actual = {
      outcome: observed.outcome,
      verdict: check?.verdict,
      check: check?.check,
      reason: observed.result.reason ?? check?.reason,
    };
    const falseAdmit = baseline.result.ok === true && observed.result.ok === true;
    const result = {
      message: msg.id ?? digestOf(msg),
      service: capture.service.options.identity,
      mutation: trial.id,
      expected,
      actual,
      baseline: { outcome: baseline.outcome },
      falseAdmit,
      verdictMatches: actual.verdict === expected.verdict,
      reasonMatches: actual.reason === expected.reason,
      checkMatches: actual.check === expected.check,
      trace: context.row.trace,
    };
    b.tried++;
    b.specified++;
    b.results.push(result);
    b.byMutation[trial.id] = (b.byMutation[trial.id] ?? 0) + 1;
    if (falseAdmit)
      b.falseAdmits.push({
        ...result,
        reproduction: { args: trial.args, store: capture.store, record: observed.record },
      });
    if (!result.reasonMatches) b.wrongReasons++;
    if (result.verdictMatches && !result.checkMatches) b.wrongChecks++;
    if (result.verdictMatches && result.reasonMatches && result.checkMatches) b.exact++;
  }
  for (const row of mutations)
    if (!trials.some((t) => t.id === row.id))
      b.notApplicable[row.id] = (b.notApplicable[row.id] ?? 0) + 1;
}
for (const [klass, name, jwsIndex] of [
  [LocalAgreementCoordinator, "request", 0],
  [LocalDatasetHolder, "query", 0],
  [LocalResourceHolder, "read", 1],
]) {
  original(
    klass.prototype,
    name,
    (method) =>
      async function (...args) {
        if (probing) return method.apply(this, args);
        const jws = args[jwsIndex];
        const msg = decode(jws);
        const sender = actorRuntime.get(msg.actor ?? msg.reader?.actor);
        const context = sender && contextOf.get(sender);
        if (!context) return method.apply(this, args);
        const capture = {
          service: this,
          at: this.options.now(),
          mandateActiveByActor: Object.fromEntries(
            context.runtimes.map((r) => [
              r.identity.actor,
              r.mandateStatus().loaded && !r.mandateStatus().revoked,
            ]),
          ),
          method,
          name,
          args: structuredClone(args),
          jwsIndex,
          sender,
          senderSnapshot: snapshot(sender),
          record: serviceRecord(this),
          store: this.options.store?.load(),
        };
        probing = true;
        try {
          await serviceMutations(context, capture);
        } finally {
          probing = false;
        }
        const result = await method.apply(this, args);
        context.services.push(capture);
        return result;
      },
  );
}

async function serviceFaults(context) {
  const pairs = new Map();
  for (const c of context.services) {
    const key = `${c.sender.identity.actor}/${c.service.options.identity}`;
    if (!pairs.has(key)) pairs.set(key, c);
  }
  for (const initialCapture of pairs.values()) {
    for (const plan of generateFaults([
      initialCapture.sender.identity.actor,
      initialCapture.service.options.identity,
    ])) {
      let capture = initialCapture;
      if (plan.kind === "change-terms" && plan.party === initialCapture.sender.identity.actor) {
        const approved = context.services.find(
          (c) =>
            c.sender === initialCapture.sender &&
            c.service === initialCapture.service &&
            c.record.entries.some(
              (e) =>
                e.record.type === "agreement-transition" &&
                e.record.signatures?.[initialCapture.sender.identity.party],
            ),
        );
        if (!approved) {
          context.c.notApplicable.push({
            party: initialCapture.sender.identity.party,
            kind: plan.kind,
            reason: "This party has no recorded acceptance before a later service request.",
          });
          continue;
        }
        capture = approved;
      }
      const request = decode(capture.args[capture.jwsIndex]);
      const recordA = structuredClone(capture.senderSnapshot.record);
      let recordB = structuredClone(capture.record);
      let observation;
      let receiverRefused = false;
      const senderFault = plan.party === capture.sender.identity.actor;
      if (
        (!senderFault && plan.kind !== "withhold-receipt") ||
        plan.kind === "deny-acknowledged" ||
        (senderFault && plan.kind === "withhold-receipt") ||
        (senderFault &&
          ["change-terms", "different-commitment"].includes(plan.kind) &&
          !request.termsDigest)
      ) {
        context.c.notApplicable.push({
          party: senderFault ? recordA.party : recordB.party,
          kind: plan.kind,
          reason:
            plan.kind === "deny-acknowledged"
              ? "No protocol acknowledgement and denial interface is available for this service exchange."
              : "This side has no applicable receipt duty, principal mandate, terms digest, or later outbound action interface. No synthetic fault assertion is substituted for an executed act.",
        });
        continue;
      }
      const expectedClause =
        plan.kind === "after-withdrawal"
          ? "CORE-OUT-10"
          : plan.kind === "outside-purpose"
            ? "CORE-OUT-5"
            : plan.kind === "withhold-receipt"
              ? "AC-1"
              : plan.kind === "deny-acknowledged"
                ? "AC-2"
                : "CORE-OUT-7";
      if (senderFault && ["after-withdrawal", "outside-purpose"].includes(plan.kind)) {
        if (plan.kind === "outside-purpose") {
          context.c.notApplicable.push({
            party: recordA.party,
            kind: plan.kind,
            reason: "No later service request carries a held item for a forbidden purpose.",
          });
          continue;
        }
        const entries = await atSnapshot(capture.sender, capture.senderSnapshot, async () => {
          const fork = await forkRuntime(capture.sender, [], {}, false);
          await fork.revokeMandate();
          return fork.ledger.entries();
        });
        recordA.entries = appendRecords(recordA.entries, entries);
        const args = structuredClone(capture.args),
          wire = args[capture.jwsIndex];
        args[capture.jwsIndex] = await resign(wire, context.keys, (m) => {
          m.id = `urn:e0:withdrawn:${digestOf(m).slice(8)}`;
          m.at = new Date(Date.parse(capture.at) + 1000).toISOString();
        });
        const receiver = await serviceReplay(
          {
            ...capture,
            mandateActiveByActor: {
              ...capture.mandateActiveByActor,
              [capture.sender.identity.actor]: false,
            },
          },
          args,
        );
        recordB = receiver.record;
        recordA.messages.push({ direction: "out", jws: args[capture.jwsIndex] });
        recordB.messages.push({ direction: "in", jws: args[capture.jwsIndex] });
        observation = {
          request: decode(args[capture.jwsIndex]).id,
          senderGateBypassed: true,
          receiverOutcome: receiver.outcome,
          receiverReason: receiver.result.reason,
        };
      } else {
        const args = structuredClone(capture.args);
        const wire = args[capture.jwsIndex];
        if (
          senderFault &&
          ["change-terms", "different-commitment", "outside-purpose"].includes(plan.kind)
        ) {
          args[capture.jwsIndex] = await resign(wire, context.keys, (m) => {
            if ("termsDigest" in m) m.termsDigest = "sha-256:e0-altered";
            else if ("purpose" in m) m.purpose = "urn:e0:outside-terms";
            else m.item = "urn:e0:other-item";
          });
        }
        const result = await serviceReplay(capture, args);
        recordB = result.record;
        recordA.messages.push({ direction: "out", jws: args[capture.jwsIndex] });
        recordB.messages.push({ direction: "in", jws: args[capture.jwsIndex] });
        observation = {
          request: request.id ?? digestOf(request),
          outcome: result.outcome,
          reason: result.result.reason,
          receiptSuppressed: plan.kind === "withhold-receipt",
        };
        receiverRefused =
          senderFault &&
          ["change-terms", "different-commitment", "outside-purpose"].includes(plan.kind) &&
          !result.result.ok;
      }
      const party = senderFault ? recordA.party : recordB.party;
      const attribution = whoWasAtFault(recordA, recordB);
      context.c.results.push({
        injected: { party, actor: plan.party, kind: plan.kind, clause: expectedClause },
        observation,
        receiverRefused,
        attribution,
        correct: attribution.party === party && attribution.clause === expectedClause,
        recordA,
        recordB,
        trace: context.row.trace,
      });
    }
  }
}

const completed = [];
try {
  for (const id of [...new Set(activePaths.map((p) => p.scenario))].sort()) {
    const loaded = loadCase(directory, id);
    contexts = activePaths
      .filter((p) => p.scenario === id)
      .map((row) => {
        const branch = loaded.scenario.branches.find((b) => b.id === row.path);
        const world = scenarioSchema.parse(
          branch ? patch(loaded.scenario, branch.change) : loaded.scenario,
        );
        const profile = domainProfileSchema.parse(
          branch?.profileChange ? patch(loaded.profile, branch.profileChange) : loaded.profile,
        );
        return {
          row,
          world,
          profile,
          remaining: world.parties.filter((p) => p.runs === "agent").length,
          keys: undefined,
          runtimes: [],
          services: [],
          receives: [],
          points: [],
          sector: catalogue.sectors[row.useCase] ?? "uncategorized",
          a: {
            proposals: 0,
            cloneComparisons: 0,
            attacker: 0,
            random: 0,
            outcomes: {},
            byCheckAndReason: {},
            propertyChecks: Object.fromEntries(Object.keys(properties).map((k) => [k, 0])),
            violations: [],
            evaluatorDisagreements: [],
            unresolvedReadings: [],
            atomicRepeats: [],
            reproductionStates: {},
            reproductionMandates: {},
          },
          b: {
            inbound: 0,
            tried: 0,
            specified: 0,
            exact: 0,
            wrongReasons: 0,
            wrongChecks: 0,
            byMutation: {},
            notApplicable: {},
            falseAdmits: [],
            unspecified: [],
            results: [],
          },
          c: { results: [], notApplicable: [] },
        };
      });
    for (const context of contexts) context.keys = await keysFor(context.world);
    creationIndex = 0;
    actorRuntime.clear();
    const results = await runScenario(loaded.profile, loaded.scenario, { commit, compare: true });
    for (const context of contexts) {
      if (!results.find((r) => r.path === context.row.path)?.trace)
        throw new Error(`manifest path no longer runs: ${id}/${context.row.path}`);
      const random = rng(`${id}/${context.row.path}`);
      probing = true;
      try {
        const randomPoints = context.points.length
          ? context.points
          : context.runtimes.slice(0, 1).map((runtime) => {
              const op = context.profile.operations[0]?.id ?? "urn:e0:operation";
              const intent = {
                action: actionTypes(context)[0] ?? "use",
                operation: op,
                target: op,
                recipient: context.world.parties[0]?.identity,
                purpose: context.profile.purposes[0]?.id,
                parameters: {},
                conversation: runtime.options.gates?.taskId ?? "urn:e0:task",
              };
              return { runtime, intent, snapshot: snapshot(runtime) };
            });
        context.a.randomState = context.points.length
          ? "scripted-proposal checkpoints"
          : "final state; no scripted outbound proposal";
        for (let i = 0; i < N && randomPoints.length; i++) {
          const point = pick(randomPoints, random);
          atSnapshot(point.runtime, point.snapshot, () => {
            const state = stateOf(point.runtime, point.intent);
            const proposal = {
              ...point.intent,
              action: pick(actionTypes(context), random),
              recipient: pick([...new Set(context.world.parties.map((p) => p.identity))], random),
              purpose: pick(
                context.profile.purposes.map((p) => p.id),
                random,
              ),
              parameters: { ...point.intent.parameters },
            };
            if (proposal.action === "pay") {
              const example = context.points.find((p) => p.intent.action === "pay")?.intent
                .parameters;
              proposal.parameters = example
                ? structuredClone(example)
                : {
                    payee: proposal.recipient,
                    amount: 1,
                    currency: "GBP",
                    reference: "urn:e0:reference",
                  };
            }
            if (state.items.length && proposal.action !== "pay")
              proposal.parameters.evidence = state.items
                .filter(() => random() < 0.5)
                .map((item) => item.id);
            saveProbe(
              context,
              context.points.indexOf(point) + 1,
              "random",
              probeOutbound(point.runtime, proposal),
            );
          });
        }
        await runAtomicRepeats(context);
        await runFaults(context);
      } finally {
        probing = false;
      }
      completed.push(context);
    }
    process.stdout.write(`${id}: ${contexts.length} paths\n`);
  }
} finally {
  for (const undo of restore.reverse()) undo();
}

const durationSeconds = Math.round((performance.now() - start) / 1000);
const meta = {
  schema: "agent-e0/1",
  evaluationSourceDigest: digestOf(
    [
      "eval/e0/run.mjs",
      "src/eval/properties.ts",
      "src/eval/mutations.ts",
      "src/eval/faults.ts",
    ].map((file) => ({ file, source: readFileSync(join(directory, file), "utf8") })),
  ),
  seed,
  randomPerPath: N,
  commit,
  manifestStatuses: ["runs", "agrees", "disagrees"],
  manifestDigest: digestOf(manifest),
  command: `pnpm --filter @jeswr/agent-reference eval:e0 --seed=${seed} --n=${N}${selected ? ` --scenario=${selected}` : ""}`,
};
const rowInfo = (c) => ({
  scenario: c.row.scenario,
  useCase: c.row.useCase,
  path: c.row.path,
  sector: c.sector,
  trace: c.row.trace,
});
write("a-worst-case.json", {
  ...meta,
  paths: completed.map((c) => ({ ...rowInfo(c), points: c.points.length, ...c.a })),
});
write("b-mutations.json", {
  ...meta,
  mutationTable: mutations,
  unspecifiedDefinitions: unspecified,
  paths: completed.map((c) => ({ ...rowInfo(c), ...c.b })),
});
write("c-faults.json", {
  ...meta,
  scope:
    "One culprit per variant. Dishonest senders bypass their own gate for actual signed faults; no compliant gate is weakened. Receiver records stop at inbound admission. No core or adapter is dispatched by an inbound replay.",
  paths: completed.map((c) => ({ ...rowInfo(c), ...c.c })),
});
const counts = (c) => ({
  a: {
    tried: c.a.proposals,
    violations: c.a.violations.length,
    disagreements: c.a.evaluatorDisagreements.length,
    unresolvedReadings: c.a.unresolvedReadings.length,
  },
  b: {
    tried: c.b.tried,
    specified: c.b.specified,
    exact: c.b.exact,
    falseAdmits: c.b.falseAdmits.length,
    wrongReasons: c.b.wrongReasons,
    wrongChecks: c.b.wrongChecks,
    unspecified: c.b.unspecified.length,
  },
  c: {
    tried: c.c.results.length,
    correct: c.c.results.filter((r) => r.correct).length,
    cannotTell: c.c.results.filter((r) => r.attribution.result === "cannot-tell").length,
    receiverRefused: c.c.results.filter((r) => r.receiverRefused).length,
  },
});
write("e0-compact.json", {
  ...meta,
  paths: completed.map((c) => ({ ...rowInfo(c), ...counts(c) })),
});
const groups = [...new Set(completed.map((c) => c.sector))]
  .sort()
  .map((sector) => [sector, completed.filter((c) => c.sector === sector)]);
groups.push(["overall", completed]);
const lines = [
  "<!-- AUTHORED-BY Codex GPT-6 -->",
  "# E0 evaluation",
  "",
  `Baseline commit: ${commit}. Seed: ${seed}. Random proposals per path: ${N}. Elapsed: ${durationSeconds} seconds.`,
  "",
  `Reproduce: \`${meta.command}\`. Requires Node 24 and installed workspace dependencies. The command builds workspace dependencies. No network or model is used.`,
  "",
  `Coverage: ${completed.length}/${paths.length} runnable manifest paths. The current manifest calls agreeing paths runs (${paths.filter((p) => p.status === "runs").length}); it has ${paths.filter((p) => p.status === "disagrees").length} disagrees paths. Blocked paths are excluded.`,
  "",
  "A check is a release decision for a proposal, not an assertion that a side effect occurred. Random proposals sample existing typed action templates. Attacker variants cover every observed non-resuming core proposal. The oracle reads exact action, target, assignee, purpose, recipient, time and prohibitions independently; emergency standing grants and registration conditions remain unresolved and are reported, not guessed.",
  "",
  "B compares check verdict, reason and deciding check separately. An admitted envelope with a quarantined changed claim has weaker standing. Mutations of already refused input remain in the data but cannot establish a false admit. Unspecified cases are excluded from exact/false-admit scores. Required-claim removal is unspecified when that same accepted claim is already held; both readings are retained. Inapplicable mutation rows are counted per input. Removal of terms applies the interaction default; it is not intrinsically a refusal.",
  "",
  "C uses real record prefixes, exact signed messages and gate replays. A dishonest sender uses fixture keys to send an actual fault message outside its own gate; the receiver runs its real gate. Receiver refusals are counted separately from faults already sent. A withheld receipt cannot be established from absence without an agreed deadline. A missing acknowledgement or commitment makes the corresponding variant inapplicable. The checker receives only the two records, without scenario or injection labels. Hash consistency does not establish completeness or external notarization.",
  "",
  "| Sector | Paths | A violations/proposals | B false admits/specified | B exact/specified | B wrong reason/specified | B wrong check/specified | C correct/variants | C cannot tell/variants |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
];
for (const [sector, group] of groups) {
  const all = group.map(counts);
  const sum = (method, key) => all.reduce((n, c) => n + c[method][key], 0);
  lines.push(
    `| ${sector} | ${group.length} | ${sum("a", "violations")}/${sum("a", "tried")} | ${sum("b", "falseAdmits")}/${sum("b", "specified")} | ${sum("b", "exact")}/${sum("b", "specified")} | ${sum("b", "wrongReasons")}/${sum("b", "specified")} | ${sum("b", "wrongChecks")}/${sum("b", "specified")} | ${sum("c", "correct")}/${sum("c", "tried")} | ${sum("c", "cannotTell")}/${sum("c", "tried")} |`,
  );
}
lines.push(
  "",
  "| Sector | A1 failures/checks | A2 failures/checks | A3 failures/checks | A4 failures/checks | A5 failures/checks | Oracle unknown/proposals | B unspecified trials/tried | C unrepresentable/plans |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
);
for (const [sector, group] of groups) {
  const total = group.reduce((n, c) => n + c.a.proposals, 0);
  const propertiesCounts = Object.keys(properties).map(
    (id) =>
      `${group.reduce((n, c) => n + c.a.violations.filter((v) => v.violations.includes(id)).length, 0)}/${total}`,
  );
  const unspecifiedCount = group.reduce(
    (n, c) => n + c.b.unspecified.filter((u) => u.actual).length,
    0,
  );
  const tried = group.reduce((n, c) => n + c.b.tried, 0);
  const unrepresentable = group.reduce((n, c) => n + c.c.notApplicable.length, 0);
  const faultPlans = unrepresentable + group.reduce((n, c) => n + c.c.results.length, 0);
  lines.push(
    `| ${sector} | ${propertiesCounts.join(" | ")} | ${group.reduce((n, c) => n + c.a.unresolvedReadings.length, 0)}/${total} | ${unspecifiedCount}/${tried} | ${unrepresentable}/${faultPlans} |`,
  );
}
const atomic = completed.flatMap((c) => c.a.atomicRepeats);
const successfulFirst = atomic.filter((r) => r.firstExecutions === 1);
lines.push(
  "",
  `Atomic single-use repeats: ${successfulFirst.filter((r) => r.totalExecutions === 1).length}/${successfulFirst.length} successful first executions had no second execution; ${atomic.filter((r) => r.firstExecutions === 0).length}/${atomic.length} trials could not execute the first action. Runtime and register records are in A.`,
  "",
);
lines.push(
  "",
  "A1 uses exact action matching. The ODRL engine treats use as an umbrella action. These oracle disagreements need Claude's adjudication; the evaluation does not claim each is a confirmed gate defect. A3 includes local principal instructions and domain memory reads that have no observed inbound admission. The literal property and these local paths need adjudication. A2 is a proposal release finding; a later payload check may still prevent transmission.",
  "",
  "Unrepresentable fault plans follow. They are not scored as executed faults.",
  "",
);
for (const c of completed)
  for (const n of c.c.notApplicable)
    lines.push(`- ${c.row.scenario}/${c.row.path}, ${n.party}, ${n.kind}: ${n.reason}`);
lines.push(
  "",
  "Every property violation follows. Each JSON entry includes the complete proposal, both readings, gate events and ledger prefix. State and mandate references resolve in that path's reproductionStates and reproductionMandates dictionaries.",
  "",
);
for (const c of completed)
  for (const v of c.a.violations)
    lines.push(
      `- ${c.row.scenario}/${c.row.path}, point ${v.point}, ${v.mutation ?? v.kind}: ${v.violations.join(", ")}; ${v.outcome} at ${v.check}/${v.reason}. ${v.cause} Trace: ${v.trace}.`,
    );
lines.push(
  "",
  "Every false admit follows. The mutation JSON contains the input and pre-state.",
  "",
);
for (const c of completed)
  for (const v of c.b.falseAdmits)
    lines.push(
      `- ${c.row.scenario}/${c.row.path}: ${v.message}, ${v.mutation}: ${v.actual.outcome}; ${v.actual.check}/${v.actual.reason}. ${v.cause ?? "The service admitted the changed signed request without weaker standing."}`,
    );
lines.push(
  "",
  "Every cannot-tell follows. These are evidence gaps, never counted as correct attributions.",
  "",
);
for (const c of completed)
  for (const v of c.c.results.filter((r) => r.attribution.result === "cannot-tell"))
    lines.push(
      `- ${c.row.scenario}/${c.row.path}, ${v.injected.party}, ${v.injected.kind}: ${v.attribution.reason} Needed: ${v.attribution.missingField}.`,
    );
lines.push(
  "",
  "Specification ambiguities, evaluator disagreements, unsupported fields and inapplicable cases remain in the full JSON. Gate, runtime and use-case files were not changed. Full verification commands and results are recorded in VALIDATION.md.",
  "",
);
writeFileSync(join(out, "E0-SUMMARY.md"), lines.join("\n"));
process.stdout.write(`E0 complete: ${completed.length} paths, ${durationSeconds}s\n`);
