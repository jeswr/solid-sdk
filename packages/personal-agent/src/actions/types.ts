/**
 * Deterministic action framework: the generic contract every action implements.
 *
 * An action is a typed, validated, machine-describable operation with an explicit effect class.
 * The framework knows nothing about calendars, providers or messages; those live in the action
 * modules. Properties every action has:
 *  - inputs and results are zod schemas (validated on the way in AND out; published as JSON
 *    Schema for operators, MCP clients and the dashboard);
 *  - `effect` says what running it may change: `read` (nothing), `prepare` (nothing; produces a
 *    plan or content for review) or `local-write` (changes local agent state; never a provider);
 *  - `capabilities` names the owner permissions it needs; `permissions()` evaluates them against
 *    the OWNER's settings — never against anything in the input — and any denial refuses;
 *  - preparation and execution are separate: an action with `execute` must first be prepared;
 *    execution takes the single-use preparation token (bound to the validated input), never new
 *    input, and only from operator origins;
 *  - no handler uses a language model, a hosted classifier or any network call that the owner
 *    has not configured server-side. Untrusted content (a message, an extraction) can be an
 *    action's INPUT, never its authority.
 */
import type { z } from "zod";

/** Who asked. Authority never comes from the origin's content; execute needs an operator origin. */
export type ActionOrigin =
  | "operator-cli"
  | "mcp"
  | "dashboard"
  | "structured-message"
  | "reviewed-extraction";
export const OPERATOR_ORIGINS: readonly ActionOrigin[] = ["operator-cli", "mcp"];

export type ActionEffect = "read" | "prepare" | "local-write";

/**
 * Outcome status. Anything other than `ok` carries reasons; none of them is ever converted into
 * a successful result by the framework.
 */
export type ActionStatus =
  | "ok" // the action did what it describes
  | "blocked" // data incomplete or unavailable: no (partial) answer is given
  | "needs-setup" // a provider/credential/configuration is missing
  | "needs-review" // the owner or operator must look (ambiguity, conflict, stale input)
  | "refused"; // not permitted (owner restriction, policy, origin)

export interface PermissionCheck {
  /** What the check is about, e.g. a calendar or account id (owner data, not input). */
  subject: string;
  capability: string;
  allowed: boolean;
  why: string;
}

export interface ActionOutcome<R> {
  status: ActionStatus;
  reasons: string[];
  result?: R;
}

/** Everything a handler may use. Built by the caller from TRUSTED configuration only. */
export interface ActionContext<Env = unknown> {
  origin: ActionOrigin;
  /** Real clock (audit, freshness). */
  now: () => Date;
  /** Scheduling clock (may be a fixed synthetic demo clock). */
  schedulingNow: () => Date;
  env: Env;
}

export interface ActionDefinition<I, R, Env = unknown> {
  id: string;
  version: string;
  title: string;
  description: string;
  effect: ActionEffect;
  /** Owner capabilities this action needs (names are defined by the action modules). */
  capabilities: readonly string[];
  /** Human notes on limits (shown in the catalogue). */
  limitations: readonly string[];
  input: z.ZodType<I>;
  result: z.ZodType<R>;
  /** An example input (may depend on the clock) for the catalogue and previews. */
  example?: (ctx: ActionContext<Env>) => I;
  /** Owner-permission evaluation (settings only). Any `allowed: false` refuses the action. */
  permissions?: (
    ctx: ActionContext<Env>,
    input: I,
  ) => PermissionCheck[] | Promise<PermissionCheck[]>;
  /** Compute, plan or render. Never has an external effect. */
  prepare: (ctx: ActionContext<Env>, input: I) => Promise<ActionOutcome<R>>;
  /** Optional effectful step (local-write only), run from a prepared token. */
  execute?: (ctx: ActionContext<Env>, input: I, prepared: R) => Promise<ActionOutcome<unknown>>;
}

/** What the catalogue publishes (no functions, no secrets). */
export interface ActionDescriptor {
  id: string;
  version: string;
  title: string;
  description: string;
  effect: ActionEffect;
  capabilities: readonly string[];
  limitations: readonly string[];
  phases: ("prepare" | "execute")[];
  executeOrigins: readonly ActionOrigin[];
  inputSchema: unknown;
  resultSchema: unknown;
  example?: unknown;
}

export interface ActionReport<R = unknown> extends ActionOutcome<R> {
  action: string;
  version: string;
  phase: "prepare" | "execute";
  origin: ActionOrigin;
  permissions: PermissionCheck[];
  /** Deterministic handlers only: recorded so consumers can rely on it. */
  deterministic: true;
  computedAt: string;
  /** Present when the prepared action can be executed (single use, expires). */
  preparation?: { token: string; digest: string; expiresAt: string };
}
