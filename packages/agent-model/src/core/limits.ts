// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Resource bounds for untrusted input and workflow execution (R15).
 *
 * Every inbound envelope, every embedded evidence item and every workflow loop in the
 * pilot runtime is bounded by these values. They are deliberately conservative; a
 * deployment may tighten them but the runtime refuses to run with a bound of zero or
 * an unbounded (non-finite) value.
 */

export interface PilotLimits {
  /** Max bytes of one wire message (compact JWS or unsigned JSON). */
  readonly maxEnvelopeBytes: number;
  /** Max JSON nesting depth of a decoded payload. */
  readonly maxJsonDepth: number;
  /** Max total JSON values (objects + arrays + scalars) in a decoded payload. */
  readonly maxJsonNodes: number;
  /** Max length of any single JSON string. */
  readonly maxStringLength: number;
  /** Max length of any JSON array. */
  readonly maxArrayLength: number;
  /** Max evidence items attached to one message. */
  readonly maxEvidenceItems: number;
  /** Accepted clock skew between peers. */
  readonly maxClockSkewMs: number;
  /** Max lifetime (expiresAt - createdAt) of one message. */
  readonly maxMessageLifetimeMs: number;
  /** Max messages (in + out) recorded in one conversation. */
  readonly maxMessagesPerConversation: number;
  /** Max proposal/counter-proposal rounds in one conversation. */
  readonly maxProposalRounds: number;
  /** Max non-terminal conversations held at once. */
  readonly maxOpenConversations: number;
  /** A non-terminal conversation older than this expires. */
  readonly conversationTtlMs: number;
  /** Max remembered message ids (the replay set); new input is refused when full. */
  readonly maxSeenMessages: number;
  /** Max outbound messages produced for one inbound message. */
  readonly maxOutboundPerStep: number;
  /** Max delivery steps a workflow driver may run before it stops. */
  readonly maxWorkflowSteps: number;
}

export const DEFAULT_LIMITS: PilotLimits = Object.freeze({
  maxEnvelopeBytes: 64 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 5000,
  maxStringLength: 16 * 1024,
  maxArrayLength: 512,
  maxEvidenceItems: 16,
  maxClockSkewMs: 5 * 60_000,
  maxMessageLifetimeMs: 24 * 3_600_000,
  maxMessagesPerConversation: 32,
  maxProposalRounds: 3,
  maxOpenConversations: 256,
  conversationTtlMs: 7 * 24 * 3_600_000,
  maxSeenMessages: 10_000,
  maxOutboundPerStep: 6,
  maxWorkflowSteps: 200,
});

/** Merge overrides and refuse non-positive / non-finite bounds (fail closed). */
export function resolveLimits(overrides: Partial<PilotLimits> = {}): PilotLimits {
  const merged = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(merged)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`limit ${name} must be a positive finite number`);
    }
  }
  return Object.freeze(merged);
}

/** A bounded-input violation. `code` is stable and appears in rejection records. */
export class BoundsError extends Error {
  constructor(
    readonly code:
      | "too-large"
      | "too-deep"
      | "too-many-nodes"
      | "string-too-long"
      | "array-too-long"
      | "not-json",
    message: string,
  ) {
    super(message);
    this.name = "BoundsError";
  }
}

/**
 * Parse untrusted JSON text under the size/depth/node bounds. The nesting depth is
 * pre-scanned linearly BEFORE `JSON.parse`, so a deeply nested document cannot exhaust
 * the parser's stack; the node/string/array bounds are checked on the parsed value.
 */
export function parseBoundedJson(text: string, limits: PilotLimits = DEFAULT_LIMITS): unknown {
  if (Buffer.byteLength(text, "utf8") > limits.maxEnvelopeBytes) {
    throw new BoundsError("too-large", `JSON exceeds ${limits.maxEnvelopeBytes} bytes`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === 0x5c) escaped = true;
      else if (ch === 0x22) inString = false;
      continue;
    }
    if (ch === 0x22) inString = true;
    else if (ch === 0x7b || ch === 0x5b) {
      depth++;
      if (depth > limits.maxJsonDepth) {
        throw new BoundsError("too-deep", `JSON nesting exceeds ${limits.maxJsonDepth}`);
      }
    } else if (ch === 0x7d || ch === 0x5d) depth--;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BoundsError("not-json", "input is not valid JSON");
  }
  assertJsonBounds(value, limits);
  return value;
}

/** Check node count, string length and array length of an already-parsed JSON value. */
export function assertJsonBounds(value: unknown, limits: PilotLimits = DEFAULT_LIMITS): void {
  let nodes = 0;
  const stack: Array<{ v: unknown; d: number }> = [{ v: value, d: 1 }];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const { v, d } = next;
    nodes++;
    if (nodes > limits.maxJsonNodes) {
      throw new BoundsError("too-many-nodes", `JSON exceeds ${limits.maxJsonNodes} values`);
    }
    if (d > limits.maxJsonDepth) {
      throw new BoundsError("too-deep", `JSON nesting exceeds ${limits.maxJsonDepth}`);
    }
    if (typeof v === "string") {
      if (v.length > limits.maxStringLength) {
        throw new BoundsError("string-too-long", `string exceeds ${limits.maxStringLength}`);
      }
    } else if (Array.isArray(v)) {
      if (v.length > limits.maxArrayLength) {
        throw new BoundsError("array-too-long", `array exceeds ${limits.maxArrayLength}`);
      }
      if (v.length > limits.maxJsonNodes - nodes - stack.length) {
        throw new BoundsError("too-many-nodes", `JSON exceeds ${limits.maxJsonNodes} values`);
      }
      for (const item of v) stack.push({ v: item, d: d + 1 });
    } else if (v !== null && typeof v === "object") {
      // Count a bounded set of own properties before reading values or queuing children.
      const keys: string[] = [];
      const remaining = limits.maxJsonNodes - nodes - stack.length;
      for (const key in v) {
        if (!Object.hasOwn(v, key)) continue;
        if (keys.length >= remaining) {
          throw new BoundsError("too-many-nodes", `JSON exceeds ${limits.maxJsonNodes} values`);
        }
        if (key.length > limits.maxStringLength) {
          throw new BoundsError("string-too-long", "object key too long");
        }
        keys.push(key);
      }
      for (const key of keys) stack.push({ v: (v as Record<string, unknown>)[key], d: d + 1 });
    }
  }
}
