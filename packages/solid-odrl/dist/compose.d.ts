import type { RequestContext } from "./types.js";
import { type AclMode, type OdrlActionName } from "./vocab.js";
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
export declare const A2A_ACTION_TO_ODRL: Readonly<Record<string, OdrlActionName>>;
/**
 * Build an ODRL {@link RequestContext} from an `@jeswr/solid-a2a`-style intent, so
 * an incoming A2A request can be evaluated against an ODRL usage-control policy.
 * Unknown verbs fall back to the `odrl:use` umbrella action. Extra attributes
 * (purpose, time, recipient) are merged in by the caller.
 */
export declare function requestContextFromA2AIntent(intent: A2AIntentLike, attributes?: RequestContext["attributes"]): RequestContext;
/**
 * Build an ODRL {@link RequestContext} from a Solid WAC-style request (an agent,
 * an ACL access mode, a resource), so an ODRL policy attached to a Solid resource
 * can be evaluated for a WAC-mode request. This is the roadmap's "a policy attaches
 * to a Solid resource" binding (evaluation direction; the OAC profile derives WAC
 * from ODRL — here we evaluate ODRL for a WAC-shaped request).
 */
export declare function requestContextFromWac(agent: string | undefined, mode: AclMode, target: string, attributes?: RequestContext["attributes"]): RequestContext;
//# sourceMappingURL=compose.d.ts.map