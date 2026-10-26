/**
 * Which policy module an agent directory uses, recorded at `init` and enforced at every open.
 *
 * SPARQ (`sparq-policy` via its `sparq-policy-decide` binary) is the pilot's default module.
 * `init` records it only after identifying a local binary and probing it — the probe must
 * show the evaluator's identity and its three-valued semantics (a prohibition that may apply
 * because context is missing is `indeterminate`, not a permit). The record pins the binary's
 * absolute path and SHA-256. On every open:
 *
 *  - a recorded binary that is missing or whose digest changed makes EVERY policy decision
 *    `indeterminate` (fail closed; re-pin with `awp-pilot policy-engine --sparq-bin`);
 *  - there is no fallback to another module; `@jeswr/solid-odrl` is used only when it is the
 *    recorded choice (`init --policy-engine=solid-odrl`), never because SPARQ is unavailable;
 *  - `AWP_POLICY_ENGINE`, if set, must name the recorded module (a mismatch is an error).
 *
 * Directories initialised before this record existed (phase 3) keep the earlier explicit
 * selection (`AWP_POLICY_ENGINE`, else solid-odrl) and are reported as `legacy-unrecorded`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import {
  type EngineRequest,
  type EngineVerdict,
  type ModuleAvailability,
  type PolicyEngine,
  type PolicyModuleInfo,
  SOLID_ODRL_ENGINE_ID,
  solidOdrlEngine,
} from "./mechanisms/policy-engine.js";
import { sparqPolicyEngine } from "./mechanisms/sparq-policy.js";

export const POLICY_ENGINE_FILE = "policy-engine.json";

export type PolicyModule = "sparq" | "solid-odrl";

export type PolicyEngineRecord =
  | {
      readonly engine: "sparq";
      /** Absolute path of the probed `sparq-policy-decide` binary. */
      readonly binary: string;
      readonly sha256: string;
      /** Evaluator identity the binary reported during the probe. */
      readonly evaluator: string;
      readonly recordedAt: string;
    }
  | { readonly engine: "solid-odrl"; readonly evaluator: string; readonly recordedAt: string };

export const SPARQ_BUILD_HINT =
  "build it in the sparq-policy worktree with `cargo build -p sparq-policy --features json-cli --bin sparq-policy-decide`";

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const PROBE_AT = "2026-01-01T00:00:00.000Z";
const PROBE_AGENT = "urn:awp:probe:agent";
const PROBE_TARGET = "urn:awp:probe:asset";
const broad: OdrlPolicy = {
  id: "urn:awp:probe:policy-broad",
  type: "Set",
  permissions: [
    { id: "urn:awp:probe:permit", type: "permission", action: "use", target: PROBE_TARGET },
  ],
};
const gated: OdrlPolicy = {
  ...broad,
  id: "urn:awp:probe:policy-gated",
  conflict: "prohibit",
  prohibitions: [
    {
      id: "urn:awp:probe:prohibit",
      type: "prohibition",
      action: "use",
      target: PROBE_TARGET,
      constraints: [
        { leftOperand: "purpose", operator: "isAnyOf", rightOperand: ["urn:awp:probe:purpose"] },
      ],
    },
  ],
};
const probeRequest: EngineRequest = {
  agent: PROBE_AGENT,
  action: "use",
  target: PROBE_TARGET,
  at: PROBE_AT,
};

/**
 * Identify and probe a local `sparq-policy-decide` binary: it must exist, and answer a
 * permit for a broad permission and `indeterminate` when a purpose-gated prohibition may
 * apply, reporting its evaluator identity both times.
 */
export function probeSparqBinary(
  path: string,
): { ok: true; binary: string; sha256: string; evaluator: string } | { ok: false; detail: string } {
  const binary = resolve(path);
  if (!existsSync(binary) || !statSync(binary).isFile())
    return { ok: false, detail: `no sparq-policy-decide binary at ${binary}; ${SPARQ_BUILD_HINT}` };
  const sha256 = sha256File(binary);
  const engine = sparqPolicyEngine({ binary });
  const permit = engine.evaluate(broad, probeRequest);
  const undecided = engine.evaluate(gated, probeRequest);
  if (permit.effect !== "permit" || !permit.evaluator)
    return { ok: false, detail: `probe: expected permit, got ${permit.effect} (${permit.reason})` };
  if (undecided.effect !== "indeterminate" || undecided.evaluator !== permit.evaluator)
    return {
      ok: false,
      detail: `probe: a possibly applicable prohibition must be indeterminate, got ${undecided.effect}`,
    };
  return { ok: true, binary, sha256, evaluator: permit.evaluator };
}

export function readPolicyEngineRecord(dir: string): PolicyEngineRecord | undefined {
  const path = join(dir, POLICY_ENGINE_FILE);
  if (!existsSync(path)) return undefined;
  const r = JSON.parse(readFileSync(path, "utf8")) as Partial<PolicyEngineRecord> & {
    binary?: unknown;
    sha256?: unknown;
  };
  if (r.engine === "solid-odrl" && typeof r.recordedAt === "string") return r as PolicyEngineRecord;
  if (
    r.engine === "sparq" &&
    typeof r.binary === "string" &&
    isAbsolute(r.binary) &&
    typeof r.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(r.sha256) &&
    typeof r.evaluator === "string" &&
    typeof r.recordedAt === "string"
  )
    return r as PolicyEngineRecord;
  throw new Error(`${path} is not a valid policy-engine record`);
}

export function writePolicyEngineRecord(dir: string, record: PolicyEngineRecord): void {
  writeFileSync(join(dir, POLICY_ENGINE_FILE), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * Resolve and probe the module for a new or re-pinned agent. `sparq` (the default) needs a
 * binary from `sparqBin` or `AWP_SPARQ_POLICY_BIN`; without one this throws — it never
 * records another module instead.
 */
export function choosePolicyEngine(input: {
  engine?: string;
  sparqBin?: string;
  env: NodeJS.ProcessEnv;
  now: Date;
}): PolicyEngineRecord {
  const engine = input.engine ?? "sparq";
  const recordedAt = input.now.toISOString();
  if (engine === "solid-odrl")
    return { engine: "solid-odrl", evaluator: SOLID_ODRL_ENGINE_ID, recordedAt };
  if (engine !== "sparq")
    throw new Error(`unknown --policy-engine ${JSON.stringify(engine)} (sparq | solid-odrl)`);
  const bin = input.sparqBin ?? input.env.AWP_SPARQ_POLICY_BIN;
  if (!bin)
    throw new Error(
      "SPARQ is the default policy module but no sparq-policy-decide binary was given: " +
        `${SPARQ_BUILD_HINT}, then pass --sparq-bin PATH (or AWP_SPARQ_POLICY_BIN); ` +
        "or choose the alternative explicitly with --policy-engine=solid-odrl",
    );
  const probe = probeSparqBinary(bin);
  if (!probe.ok) throw new Error(`SPARQ policy module not usable: ${probe.detail}`);
  return {
    engine: "sparq",
    binary: probe.binary,
    sha256: probe.sha256,
    evaluator: probe.evaluator,
    recordedAt,
  };
}

/** An engine that refuses every decision (the recorded module is unusable). */
export function unavailableEngine(reason: string, module?: PolicyModuleInfo): PolicyEngine {
  return {
    id: "unavailable",
    ...(module ? { module } : {}),
    availability: () => ({ status: "unavailable", reason }),
    evaluate: (): EngineVerdict => ({
      effect: "indeterminate",
      reason: `policy module unavailable: ${reason}`,
    }),
  };
}

/** Shareable module metadata from a reported evaluator identity (`name@version rest`). */
export function moduleInfoFromEvaluator(evaluator: string): PolicyModuleInfo {
  const m = /^([^@\s]+)@(\S+) (.+)$/.exec(evaluator);
  return m
    ? { name: m[1] as string, version: m[2] as string, interface: `${m[3]} (local process)` }
    : { name: evaluator, version: "unknown", interface: "local process" };
}

/**
 * Is the pinned binary still the probed one? (Re-checked before every decision.) Reasons carry
 * no local path: they can reach decision records and refusals; the operator sees the recorded
 * path via `awp-pilot policy-engine`.
 */
function pinCheck(record: Extract<PolicyEngineRecord, { engine: "sparq" }>): ModuleAvailability {
  try {
    if (!existsSync(record.binary) || !statSync(record.binary).isFile())
      return {
        status: "unavailable",
        reason: `the recorded sparq-policy-decide binary is missing; ${SPARQ_BUILD_HINT} and re-pin`,
      };
    if (sha256File(record.binary) !== record.sha256)
      return {
        status: "unavailable",
        reason:
          "the recorded sparq-policy-decide binary changed since it was probed; stop the service and re-pin with `awp-pilot policy-engine --sparq-bin`",
      };
  } catch {
    return { status: "unavailable", reason: "the recorded binary cannot be checked" };
  }
  return { status: "ready" };
}

/**
 * The SPARQ engine for a recorded module. The pin (path + SHA-256) is re-checked immediately
 * before EVERY decision, so a long-running service never executes a replaced or removed
 * binary: it answers `indeterminate` instead. This detects replacement between decisions;
 * it is not a defence against a compromised host (a swap between the check and the spawn,
 * or a compromised process, is out of scope).
 */
export function pinnedSparqEngine(
  record: Extract<PolicyEngineRecord, { engine: "sparq" }>,
): PolicyEngine {
  const inner = sparqPolicyEngine({ binary: record.binary });
  const module = moduleInfoFromEvaluator(record.evaluator);
  return {
    id: inner.id,
    module,
    availability: () => pinCheck(record),
    evaluate(policy, request) {
      const now = pinCheck(record);
      if (now.status !== "ready")
        return { effect: "indeterminate", reason: `policy module unavailable: ${now.reason}` };
      return inner.evaluate(policy, request);
    },
  };
}

export interface ResolvedPolicyEngine {
  readonly module: PolicyModule | "missing-record";
  /** `recorded` (from policy-engine.json) or `legacy-unrecorded` (pre-phase-4 directory). */
  readonly source: "recorded" | "legacy-unrecorded";
  readonly engine: PolicyEngine;
  /** Availability when resolved; call `engine.availability()` for the current state. */
  readonly status: string;
  readonly record?: PolicyEngineRecord;
}

/** Current status line of a resolved engine (`ready` or `unavailable: …`). */
export function currentStatus(resolved: ResolvedPolicyEngine): string {
  const a = resolved.engine.availability?.() ?? { status: "ready" as const };
  const base = a.status === "ready" ? "ready" : `unavailable: ${a.reason}`;
  return resolved.source === "legacy-unrecorded" && a.status === "ready" ? resolved.status : base;
}

/**
 * The module an agent directory must use now (see module doc). `recordRequired` is set for
 * directories whose `init` wrote a record: a missing record then fails closed rather than
 * being read as a legacy directory.
 */
export function policyEngineForAgent(
  dir: string,
  env: NodeJS.ProcessEnv,
  options: { recordRequired?: boolean } = {},
): ResolvedPolicyEngine {
  const record = readPolicyEngineRecord(dir);
  const requested = env.AWP_POLICY_ENGINE;
  if (requested && requested !== "sparq" && requested !== "solid-odrl")
    throw new Error(`unknown AWP_POLICY_ENGINE ${JSON.stringify(requested)}`);
  if (!record && options.recordRequired) {
    const why = `${POLICY_ENGINE_FILE} is missing; re-pin with \`awp-pilot policy-engine\``;
    return {
      module: "missing-record",
      source: "recorded",
      engine: unavailableEngine(why),
      status: `unavailable: ${why}`,
    };
  }
  if (!record) {
    if (requested === "sparq") {
      const binary = env.AWP_SPARQ_POLICY_BIN;
      if (!binary) throw new Error("AWP_POLICY_ENGINE=sparq requires AWP_SPARQ_POLICY_BIN");
      const inner = sparqPolicyEngine({ binary });
      return {
        module: "sparq",
        source: "legacy-unrecorded",
        engine: {
          ...inner,
          module: {
            name: "sparq-policy",
            version: "unpinned",
            interface: "sparq-policy-decide/1 (local process)",
          },
          availability: () =>
            existsSync(binary)
              ? { status: "ready" }
              : { status: "unavailable", reason: `no binary at ${binary}` },
        },
        status: "ready (unpinned: legacy directory selected by AWP_POLICY_ENGINE)",
      };
    }
    return {
      module: "solid-odrl",
      source: "legacy-unrecorded",
      engine: solidOdrlEngine,
      status: "ready (legacy directory; re-pin with `awp-pilot policy-engine`)",
    };
  }
  if (requested && requested !== record.engine)
    throw new Error(
      `AWP_POLICY_ENGINE=${requested} conflicts with the recorded policy module ${record.engine}; ` +
        "change the record explicitly with `awp-pilot policy-engine`",
    );
  if (record.engine === "solid-odrl")
    return {
      module: "solid-odrl",
      source: "recorded",
      engine: solidOdrlEngine,
      status: "ready",
      record,
    };
  // The SAME pinned engine is returned whether or not the binary is currently usable: it
  // re-checks before every decision, so availability can change while a service runs.
  const engine = pinnedSparqEngine(record);
  const now = engine.availability?.() ?? { status: "ready" as const };
  return {
    module: "sparq",
    source: "recorded",
    engine,
    status: now.status === "ready" ? "ready" : `unavailable: ${now.reason}`,
    record,
  };
}

const UNANSWERED =
  /^(policy evaluator unavailable|policy module unavailable|policy not serialisable)/;

/**
 * Wrap an engine to tally, per evaluator identity and effect, every verdict it returns
 * (evidence for reports). Verdicts the module did not actually answer (process failure,
 * unusable record, unserialisable policy) are tallied as `UNANSWERED`, not as the module.
 */
export function tallyingEngine(inner: PolicyEngine): {
  engine: PolicyEngine;
  tally(): Record<string, number>;
} {
  const counts: Record<string, number> = {};
  return {
    engine: {
      id: inner.id,
      evaluate(policy, request) {
        const v = inner.evaluate(policy, request);
        const who = UNANSWERED.test(v.reason)
          ? `UNANSWERED (${inner.id})`
          : (v.evaluator ?? inner.id);
        const key = `${who} | ${v.effect}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return v;
      },
    },
    tally: () => ({ ...counts }),
  };
}
