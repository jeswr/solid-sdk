import type { ConflictStrategy, LeftOperandName, OdrlActionName, OperatorName } from "./vocab.js";
/** The ODRL policy subtype. `Set` is the default; `Offer`/`Agreement` carry parties. */
export type PolicyType = "Set" | "Offer" | "Agreement";
/** The ODRL rule kind. */
export type RuleType = "permission" | "prohibition" | "obligation";
/**
 * A single ODRL constraint (a boolean condition on a rule). A request satisfies it
 * when `<request value for leftOperand> <operator> <rightOperand>` holds. The
 * `rightOperand` may be a scalar (string/number) or a list (for set operators like
 * `isAnyOf`); `datatype` is the XSD datatype IRI for typed comparison
 * (e.g. `xsd:dateTime`, `xsd:integer`) — defaulted by left-operand where omitted.
 */
export interface OdrlConstraint {
    /** The constraint subject — what about the request is being constrained. */
    readonly leftOperand: LeftOperandName;
    /** The relational operator. */
    readonly operator: OperatorName;
    /** The value(s) the request value is compared against. */
    readonly rightOperand: string | number | ReadonlyArray<string | number>;
    /** Optional XSD datatype IRI for typed comparison (else inferred by leftOperand). */
    readonly datatype?: string;
}
/**
 * An ODRL Duty — a requirement (a "must do" action). A duty attached to a
 * permission (`duties`) conditions that permission: the permission only grants if
 * the duty is fulfilled. An obligation-level duty (`Policy.obligations`) stands on
 * its own. A duty may itself carry constraints.
 */
export interface OdrlDuty {
    /** Optional duty node IRI. */
    readonly id?: string;
    /** The duty action (e.g. `attribute`, `compensate`, `inform`, `delete`). */
    readonly action: OdrlActionName;
    /** Optional target asset the duty applies to. */
    readonly target?: string;
    /** Optional constraints on the duty. */
    readonly constraints?: readonly OdrlConstraint[];
}
/** An ODRL Rule (Permission / Prohibition / Obligation). */
export interface OdrlRule {
    /** Optional rule node IRI. */
    readonly id?: string;
    /** The rule kind. */
    readonly type: RuleType;
    /** The action concept the rule is about. */
    readonly action: OdrlActionName;
    /** The target Asset IRI the rule governs (the Solid resource). */
    readonly target?: string;
    /** The Party the rule is granted to (an agent WebID). */
    readonly assignee?: string;
    /** The Party issuing the rule (the resource owner's WebID). */
    readonly assigner?: string;
    /** Constraints refining the rule (ALL must hold for the rule to apply). */
    readonly constraints?: readonly OdrlConstraint[];
    /**
     * Duties that CONDITION a permission (ODRL `odrl:duty`). Only meaningful on a
     * `permission` rule: the permission grants only if every duty is dischargeable.
     */
    readonly duties?: readonly OdrlDuty[];
}
/** A full ODRL Policy (a graph of rules). */
export interface OdrlPolicy {
    /** The policy IRI / uid. */
    readonly id: string;
    /** The policy subtype (default `Set`). */
    readonly type?: PolicyType;
    /** ODRL profile IRI(s) the policy conforms to. */
    readonly profile?: string | readonly string[];
    /** Policy-level assigner (the owner), inherited by rules that omit one. */
    readonly assigner?: string;
    /** Policy-level assignee, inherited by rules that omit one. */
    readonly assignee?: string;
    /** The conflict-resolution strategy (default `prohibit` — deny wins; see eval). */
    readonly conflict?: ConflictStrategy;
    /**
     * Agent-delegation profile (`docs/delegation-profile.md`): the IRI of the policy
     * UNDER WHOSE AUTHORITY this policy was issued (`odrld:delegatedUnder`, a
     * subproperty of `prov:wasDerivedFrom`). A delegated Agreement MUST declare its
     * parent here; the chain evaluator ({@link evaluateDelegated}) verifies the edge
     * fail-closed. Absent on a root/ordinary policy.
     */
    readonly delegatedUnder?: string;
    /** The rules. Convenience: split out by kind for ergonomic construction. */
    readonly permissions?: readonly OdrlRule[];
    readonly prohibitions?: readonly OdrlRule[];
    /** Policy-level obligations (duties not tied to a single permission). */
    readonly obligations?: readonly OdrlDuty[];
}
/**
 * A request context evaluated against a policy: "agent A wants to perform action X
 * on target T, under these circumstances." Pure data — the evaluator never fetches
 * anything; the caller assembles the context (the request time, the purpose the
 * caller asserts, the recipient, etc.).
 */
export interface RequestContext {
    /** The agent WebID performing the action (matched against `assignee`). */
    readonly agent?: string;
    /** The action requested (an ODRL action short name). */
    readonly action: OdrlActionName;
    /** The target Asset IRI requested (the Solid resource). */
    readonly target?: string;
    /**
     * The values the request asserts for each constrainable left-operand, used to
     * evaluate constraints. e.g. `{ dateTime: "2026-06-16T10:00:00Z", purpose:
     * "https://w3id.org/dpv#ResearchAndDevelopment", count: 1 }`. A constraint whose
     * left-operand is absent here is treated as UNSATISFIED (fail-closed). A boolean
     * value is used for duty-discharge flags (`"fulfilled:<action>": true`).
     */
    readonly attributes?: Readonly<Record<string, string | number | boolean | ReadonlyArray<string | number>>>;
}
/** The decision a policy evaluation yields for a request. */
export type Decision = "permit" | "deny" | "notApplicable";
/** A reference to the rule that produced a decision (for explainability). */
export interface DecisionRule {
    readonly type: RuleType;
    readonly action: OdrlActionName;
    readonly target?: string;
    readonly assignee?: string;
    /** The rule IRI if it had one. */
    readonly id?: string;
}
/** A duty that a permit decision is contingent on (the assignee must discharge it). */
export interface ActiveDuty {
    readonly action: OdrlActionName;
    readonly target?: string;
    readonly id?: string;
    /** Whether the evaluator could confirm the duty is discharged from the context. */
    readonly fulfilled: boolean;
}
/**
 * The full, explainable evaluation result. `decision` is the bottom line; the
 * other fields explain WHY (which rules matched, which constraints failed, which
 * duties are outstanding) so a caller can surface an actionable reason and, for a
 * permit-with-duty, know what the assignee must still do.
 */
export interface EvaluationResult {
    /** The bottom-line decision. */
    readonly decision: Decision;
    /**
     * Human/agent-readable reason: which rule (or conflict strategy, or "no matching
     * rule") drove the decision.
     */
    readonly reason: string;
    /** The permission rule(s) that matched the request (action+target+assignee+constraints). */
    readonly matchedPermissions: readonly DecisionRule[];
    /** The prohibition rule(s) that matched the request. */
    readonly matchedProhibitions: readonly DecisionRule[];
    /**
     * Duties the assignee must discharge for the permit to be honoured (from the
     * matched permission's duties + policy obligations). On a `deny`/`notApplicable`
     * this is empty. A permit with an UNFULFILLED duty is reported here; whether to
     * gate on it is the caller's policy (see {@link EvaluateOptions.requireDuties}).
     */
    readonly duties: readonly ActiveDuty[];
    /** Whether the conflict-resolution strategy was invoked (perm vs prohibit collided). */
    readonly conflict: boolean;
}
/** Options controlling evaluation semantics. */
export interface EvaluateOptions {
    /**
     * Treat an unfulfilled duty as a DENY (strict). When `false` (the default), a
     * permission with an unfulfilled duty still permits but reports the outstanding
     * duty in {@link EvaluationResult.duties} (advisory) — matching ODRL's model
     * where a duty is an obligation tracked alongside, not a precondition gate,
     * unless the caller opts in.
     */
    readonly requireDuties?: boolean;
    /**
     * The "now" instant for evaluating `odrl:dateTime` constraints when the request
     * context does not assert a `dateTime` attribute. Defaults to the real current
     * time. Injectable so evaluation is deterministic + testable.
     */
    readonly now?: Date;
}
//# sourceMappingURL=types.d.ts.map