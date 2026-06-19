// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Composition helpers that tie an ODRL policy to the sibling agentic-Solid
// packages WITHOUT a hard dependency on them (the roadmap's "an ODRL policy
// attaches to an agent interaction / a resource"). These are pure, dependency-free
// adapters: they translate the structurally-shared fields (an agent WebID, an
// A2A action verb + target + ACL modes) into the ODRL model, so a consumer can
// gate an `@jeswr/solid-a2a` request or reference an `@jeswr/solid-agent-card`
// agent without this package importing those packages.

import type { RequestContext } from "./types.js";
import { ACL_MODE_TO_ACTION, type AclMode, type OdrlActionName } from "./vocab.js";

/**
 * A minimal structural view of an `@jeswr/solid-a2a` Intent — only the fields this
 * package needs. Declared structurally (not imported) so `@jeswr/solid-odrl` does
 * not depend on `@jeswr/solid-a2a` (composition, not coupling). The real
 * `solid-a2a` `Intent` is assignable to this.
 */
export interface A2AIntentLike {
  /** The A2A intent action verb (`read`/`create`/`update`/`append`/`delete`/…). */
  readonly action: string;
  /** The target resource IRI (schema:object / schema:target of the intent). */
  readonly target?: string;
  /** The requesting agent WebID (schema:agent). */
  readonly agent?: string;
  /** The recipient of a grant intent (schema:recipient). */
  readonly recipient?: string;
  /** The requested ACL modes on a grant intent. */
  readonly modes?: readonly AclMode[];
}

/**
 * Map an `@jeswr/solid-a2a` intent action verb to the corresponding ODRL action.
 * The A2A surface uses schema.org-style verbs (`read`/`create`/`update`/`append`/
 * `delete`/`list`/`grant`/`subscribe`/`query`); ODRL uses its own action concepts.
 * Verbs without a precise ODRL action map onto the `odrl:use` umbrella so a policy
 * can still gate them.
 */
export const A2A_ACTION_TO_ODRL: Readonly<Record<string, OdrlActionName>> = {
  read: "read",
  create: "write",
  update: "modify",
  // `append` is add-only — a STRICT subclass of write (WAC `acl:Append`). Mapping it
  // to `modify` was an OVER-GRANT (an append-only intent compiled to full data
  // mutation). Map to the narrow `append` action instead — never broadens. See
  // ACL_MODE_TO_ACTION in vocab.ts for the same tightening on the WAC side.
  append: "append",
  delete: "delete",
  list: "read",
  grant: "use",
  subscribe: "use",
  query: "read",
};

/**
 * Build an ODRL {@link RequestContext} from an `@jeswr/solid-a2a`-style intent, so
 * an incoming A2A request can be evaluated against an ODRL usage-control policy.
 * Unknown verbs fall back to the `odrl:use` umbrella action. Extra attributes
 * (purpose, time, recipient) are merged in by the caller.
 */
export function requestContextFromA2AIntent(
  intent: A2AIntentLike,
  attributes?: RequestContext["attributes"],
): RequestContext {
  const action = A2A_ACTION_TO_ODRL[intent.action] ?? "use";
  // A grant intent's recipient is a natural ODRL `recipient` constraint input.
  const mergedAttributes: Record<
    string,
    string | number | boolean | ReadonlyArray<string | number>
  > = {
    ...(attributes ?? {}),
  };
  if (intent.recipient !== undefined && mergedAttributes.recipient === undefined) {
    mergedAttributes.recipient = intent.recipient;
  }
  return {
    action,
    ...(intent.target !== undefined && { target: intent.target }),
    ...(intent.agent !== undefined && { agent: intent.agent }),
    ...(Object.keys(mergedAttributes).length > 0 && { attributes: mergedAttributes }),
  };
}

/**
 * Build an ODRL {@link RequestContext} from a Solid WAC-style request (an agent,
 * an ACL access mode, a resource), so an ODRL policy attached to a Solid resource
 * can be evaluated for a WAC-mode request. This is the roadmap's "a policy attaches
 * to a Solid resource" binding (evaluation direction; the OAC profile derives WAC
 * from ODRL — here we evaluate ODRL for a WAC-shaped request).
 */
export function requestContextFromWac(
  agent: string | undefined,
  mode: AclMode,
  target: string,
  attributes?: RequestContext["attributes"],
): RequestContext {
  return {
    action: ACL_MODE_TO_ACTION[mode],
    target,
    ...(agent !== undefined && { agent }),
    ...(attributes !== undefined && { attributes }),
  };
}
