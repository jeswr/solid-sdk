// Runs a target's scenarios into a Report.
// - PASS needs at least one check and no exception.
// - UNSUPPORTED only when the manifest declares the capability `false` (with a reason) or lists the scenario in
//   `unsupported`; an undeclared capability is UNTESTED (a configuration gap, which strict mode fails).
// - A scenario can report itself UNTESTED only through `untested(config)` before it runs (e.g. no scratch
//   container configured for writes on a live pod) — never by passing vacuously.
// - Scenarios whose prerequisites did not pass FAIL as blocked.
// - `knownIncompatible[scenario] = {reason, signature}` (manifest): the scenario still runs every time; a failure
//   whose description matches `signature` is recorded UNSUPPORTED ("verified this run"), and scenarios depending
//   on it are UNSUPPORTED too. If it passes, or fails differently, that is a FAIL (the declaration is stale).
// - Every scenario gets an abort signal; on timeout it is aborted and awaited for a bounded grace period. If it
//   still has not stopped, the rest of the target is blocked, so nothing overlaps work that may still be running.
import { CheckError } from "./checkError.js";
import { describeError, safeDescription } from "./redact.js";
import { FAIL, PASS, UNSUPPORTED, UNTESTED } from "./report.js";

export { CheckError };

/** What a scenario body receives: checks are counted, and `flow` records safe facts about what happened. */
export class ScenarioContext {
  checks = 0;
  flow = {};
  /** Capabilities declared "unverified" that this scenario asserted because the run exercises them. */
  exercised = new Set();

  constructor(signal) {
    this.signal = signal;
  }

  check(condition, message) {
    this.checks++;
    if (!condition) throw new CheckError(message);
  }

  /** For non-sensitive values only (statuses, counts, scheme names). */
  equal(actual, expected, message) {
    this.checks++;
    if (!Object.is(actual, expected))
      throw new CheckError(`${message}: expected ${show(expected)}, got ${show(actual)}`);
  }

  /** Checks without echoing either value (accounts, WebIDs, subjects, tokens). */
  same(actual, expected, message) {
    this.checks++;
    if (!Object.is(actual, expected)) throw new CheckError(`${message} (values withheld)`);
  }

  /** Checks that two sensitive values differ, without echoing them. */
  differ(a, b, message) {
    this.checks++;
    if (Object.is(a, b)) throw new CheckError(`${message} (values withheld)`);
  }

  note(facts) {
    Object.assign(this.flow, facts);
  }

  /**
   * Whether this scenario must assert `capability` (see {@link expectsCapability}); an exercised unverified
   * capability is recorded, so the report shows it was observed in this run rather than declared beforehand.
   */
  expects(env, capability) {
    const expected = expectsCapability(env, capability);
    if (expected && env.capabilities?.[capability] === "unverified") this.exercised.add(capability);
    return expected;
  }
}

/**
 * The one policy for capability-dependent assertions: assert a feature when the manifest declares it (`true`), or
 * when it is `"unverified"` and the run explicitly exercises unverified capabilities (`--exercise-unverified`) —
 * then the assertion decides, and an absent feature fails. `false` (known absence) is never asserted.
 */
export function expectsCapability(env, capability) {
  const value = env.capabilities?.[capability];
  return value === true || (value === "unverified" && env.exerciseUnverified === true);
}

function show(value) {
  return typeof value === "string"
    ? JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}...` : value)
    : String(value);
}

/**
 * Why a scenario cannot run as a PASS/FAIL here, or `undefined` when it can.
 * @returns {{status: string, reason: string} | undefined}
 */
export function applicability(target, scenario, config, { exerciseUnverified = false } = {}) {
  const declared = target.unsupported?.[scenario.id];
  if (declared !== undefined) return { status: UNSUPPORTED, reason: declared };
  for (const capability of scenario.needs ?? []) {
    const value = target.capabilities?.[capability];
    if (value === false) return { status: UNSUPPORTED, reason: target.capabilityNotes[capability] };
    if (value === "unverified" && !exerciseUnverified)
      return {
        status: UNTESTED,
        reason: `capability "${capability}" is unverified: ${target.capabilityNotes[capability]} (run with --exercise-unverified to test it)`,
      };
    if (value !== true && value !== "unverified")
      return {
        status: UNTESTED,
        reason: `capability "${capability}" is not declared for this target (configuration gap)`,
      };
  }
  const untested = scenario.untested?.(config);
  if (untested !== undefined) return { status: UNTESTED, reason: untested };
  return undefined;
}

/**
 * @param {import("./report.js").Report} report
 * @param {object} target manifest target
 * @param {Array<{id: string, needs?: string[], after?: string[], always?: boolean, timeoutMs?: number,
 *   untested?(config): string | undefined, run(ctx: ScenarioContext, state: object): Promise<void>}>} scenarios
 * @param {object} state shared between the scenarios of this target
 * @param {{config?: object, live?: boolean, timeoutMs?: number, graceMs?: number, log?: Function}} options
 *   `live`: failure reasons are reduced to allowlisted, non-identifying descriptions
 */
export async function runScenarios(
  report,
  target,
  scenarios,
  state,
  {
    config = {},
    live = false,
    exerciseUnverified = false,
    timeoutMs = 120_000,
    graceMs = 10_000,
    log = () => {},
  } = {},
) {
  const outcome = new Map();
  const incompatible = new Map(); // scenario id -> verified known-incompatibility reason
  let stuck;
  const describe = live ? safeDescription : describeError;
  const record = (scenario, result) => {
    report.record(target.id, { id: scenario.id, ...result });
    outcome.set(scenario.id, result.status);
    const detail = result.reason
      ? ` (${result.reason})`
      : ` (${result.checks} checks, ${Math.round(result.durationMs)} ms)`;
    log(
      `  ${result.status === PASS ? "✓" : result.status === FAIL ? "x" : "-"} ${scenario.id}: ${result.status}${detail}`,
    );
  };

  for (const scenario of scenarios) {
    const inapplicable = applicability(target, scenario, config, { exerciseUnverified });
    // Unverified capabilities this scenario exercises: the outcome is what this run observed, not prior proof.
    const exercised = (scenario.needs ?? []).filter(
      (c) => target.capabilities?.[c] === "unverified",
    );
    if (inapplicable !== undefined) {
      record(scenario, inapplicable);
      continue;
    }
    if (stuck !== undefined) {
      record(scenario, {
        status: FAIL,
        reason: `blocked: ${stuck} did not stop after its timeout; nothing may overlap it`,
      });
      continue;
    }
    const blocker = (scenario.after ?? []).find((id) => outcome.get(id) !== PASS);
    if (blocker !== undefined && incompatible.has(blocker)) {
      record(scenario, {
        status: UNSUPPORTED,
        reason: `depends on ${blocker}: ${incompatible.get(blocker)}`,
      });
      continue;
    }
    if (blocker !== undefined && scenario.always !== true) {
      record(scenario, {
        status: FAIL,
        reason: `blocked: prerequisite ${blocker} did not pass (${outcome.get(blocker) ?? "not run"})`,
      });
      continue;
    }

    const limit = scenario.timeoutMs ?? timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`timed out after ${limit} ms`)),
      limit,
    );
    const ctx = new ScenarioContext(controller.signal);
    const started = performance.now();
    // Settles to a result object: never rejects, so nothing goes unhandled if a timeout wins the race.
    const running = Promise.resolve()
      .then(() => scenario.run(ctx, state))
      .then(
        () => ({ done: true }),
        (error) => ({ error }),
      );
    const aborted = new Promise((resolve) =>
      controller.signal.addEventListener("abort", () => resolve({ timeout: true }), { once: true }),
    );
    let status = PASS;
    let reason;
    const result = await Promise.race([running, aborted]);
    clearTimeout(timer);
    if (result.timeout) {
      status = FAIL;
      reason = `timed out after ${limit} ms`;
      // Give the aborted work a bounded chance to unwind before anything else runs.
      let grace;
      const settled = await Promise.race([
        running.then(() => true),
        new Promise((resolve) => {
          grace = setTimeout(resolve, graceMs, false);
        }),
      ]);
      clearTimeout(grace);
      if (!settled) stuck = scenario.id;
    } else if (result.error !== undefined) {
      status = FAIL;
      reason = describe(result.error);
    } else if (ctx.checks === 0) {
      status = FAIL;
      reason = "the scenario ran no checks (refusing to report a pass without evidence)";
    }
    controller.abort(new Error("scenario finished")); // releases anything still listening (pages, listeners)
    const known = target.knownIncompatible?.[scenario.id];
    if (known !== undefined) {
      // Only a completed scenario's own error can match: timeouts and missing checks never do.
      if (
        status === FAIL &&
        result.error !== undefined &&
        new RegExp(known.signature).test(reason)
      ) {
        incompatible.set(scenario.id, known.reason);
        status = UNSUPPORTED;
        reason = `known incompatibility, verified this run: ${known.reason}`;
      } else {
        reason =
          status === PASS
            ? "declared known incompatibility did not reproduce (the scenario passed): update the manifest"
            : `failed differently from the declared known incompatibility: ${reason}`;
        status = FAIL;
      }
    }
    const allExercised = [...new Set([...exercised, ...ctx.exercised])];
    if (allExercised.length > 0) ctx.note({ exercisedUnverified: allExercised.join(",") });
    record(scenario, {
      status,
      reason,
      durationMs: performance.now() - started,
      checks: ctx.checks,
      flow: Object.keys(ctx.flow).length > 0 ? ctx.flow : undefined,
    });
  }
  return outcome;
}
