// AUTHORED-BY Claude Opus 5.5
/**
 * Trust as a lookup, not one stored list (trust suite `register-chain`). A question goes
 * first to the principal's own list (scoped by task or claim type; it can also block), then
 * to a root the principal accepts, which delegates to the register that answers for that
 * kind of party. Every answer carries the path that produced it, when it was checked and
 * when it expires.
 *
 * The own list for sources is the local trust store's source-authority rules, so the gate and
 * the pilot's domain handlers read the same rules. Roots and registers here are synthetic
 * in-memory fixtures.
 */
import type { Iri } from "../core/types.js";
import type { TrustStore } from "../mechanisms/trust.js";

export type PathKind = "own-list" | "root" | "register" | "federation" | "international";

export interface PathStep {
  /** Who was consulted, by display name. */
  readonly at: string;
  readonly kind: PathKind;
  readonly says: string;
}

export type ResolutionOutcome = "accepted" | "not-accepted" | "blocked" | "no-route" | "unresolved";

export interface Resolution {
  readonly question: string;
  readonly path: readonly PathStep[];
  readonly answer: string;
  readonly outcome: ResolutionOutcome;
  readonly checkedAt: string;
  readonly expires?: string;
  /** The rule or register entry the answer rests on. */
  readonly rule?: { readonly id: string; readonly version?: string };
}

/** An entry the principal chose: accepted (or blocked) for named tasks. */
export interface OwnListEntry {
  readonly party: Iri;
  /** Operation ids this party is accepted as a recipient for. */
  readonly tasks: readonly Iri[];
  readonly block?: boolean;
  readonly note?: string;
}

export interface RegisterEntry {
  readonly party: Iri;
  /** What the register says the party is authorized for (operation ids). */
  readonly authorizedFor: readonly Iri[];
  readonly status: "authorized" | "suspended" | "withdrawn";
  readonly id: string;
}

export interface Register {
  readonly id: Iri;
  readonly name: string;
  /** The kind of party it answers for, in plain words ("lenders"). */
  readonly answersFor: string;
  readonly entries: readonly RegisterEntry[];
  /** How long one of its answers may be relied on. */
  readonly answerTtlMs: number;
}

export interface TrustRoot {
  readonly id: Iri;
  readonly name: string;
  readonly delegates: readonly Register[];
}

export interface TrustResolverOptions {
  /** Display name of the principal whose list this is ("Sam"). */
  readonly principal: string;
  readonly trust: TrustStore;
  readonly ownList?: readonly OwnListEntry[];
  readonly root?: TrustRoot;
  readonly name: (iri: string | undefined) => string;
}

export class TrustResolver {
  constructor(private readonly opts: TrustResolverOptions) {}

  private get ownListName(): string {
    return `${this.opts.principal}'s own list`;
  }

  /** Is `source` accepted for claims of `claimType` about `subject`? Own list only. */
  resolveSource(input: {
    evaluator: Iri;
    source: Iri;
    claimType: string;
    subject?: Iri;
    at: string;
  }): Resolution {
    const { name } = this.opts;
    const question = `Is ${name(input.source)} an authority for ${input.claimType} claims${
      input.subject ? ` about ${name(input.subject)}` : ""
    }?`;
    const a = this.opts.trust.assessSource(input);
    const says =
      a.outcome === "accepted"
        ? `${name(input.source)} is accepted for ${input.claimType} (rule ${a.rule?.id ?? "?"}).`
        : (a.reason ?? "no rule recognises this source");
    const answer =
      a.outcome === "accepted"
        ? `Accepted, for ${input.claimType} claims only.`
        : a.outcome === "unresolved"
          ? "Cannot tell."
          : `Not accepted for ${input.claimType}.`;
    return {
      question,
      path: [{ at: this.ownListName, kind: "own-list", says }],
      answer,
      outcome: a.outcome === "not-accepted" ? "not-accepted" : a.outcome,
      checkedAt: input.at,
      ...(a.rule ? { rule: a.rule } : {}),
    };
  }

  /** May `party` receive this for `task` (an operation id)? Own list, then root, then register. */
  resolveRecipient(input: { party: Iri; task: Iri; taskLabel: string; at: string }): Resolution {
    const { name } = this.opts;
    const question = `Is ${name(input.party)} a party I can send ${input.taskLabel} to?`;
    const path: PathStep[] = [];
    const own = (this.opts.ownList ?? []).find((e) => e.party === input.party);
    if (own?.block) {
      path.push({
        at: this.ownListName,
        kind: "own-list",
        says: `${name(input.party)} is blocked.`,
      });
      return { question, path, answer: "Blocked.", outcome: "blocked", checkedAt: input.at };
    }
    if (own?.tasks.includes(input.task)) {
      path.push({
        at: this.ownListName,
        kind: "own-list",
        says: `${name(input.party)} is accepted for ${input.taskLabel}.`,
      });
      return {
        question,
        path,
        answer: `Accepted, for ${input.taskLabel} only.`,
        outcome: "accepted",
        checkedAt: input.at,
      };
    }
    path.push({
      at: this.ownListName,
      kind: "own-list",
      says: own
        ? `${name(input.party)} is listed, but not for ${input.taskLabel}.`
        : `No entry for ${name(input.party)}.`,
    });
    const root = this.opts.root;
    if (!root) {
      return {
        question,
        path,
        answer: "No root to ask.",
        outcome: "no-route",
        checkedAt: input.at,
      };
    }
    const register = root.delegates.find((r) => r.entries.some((e) => e.party === input.party));
    if (!register) {
      path.push({
        at: root.name,
        kind: "root",
        says: `No register it delegates to lists ${name(input.party)}.`,
      });
      return {
        question,
        path,
        answer: "No register answers for this party.",
        outcome: "no-route",
        checkedAt: input.at,
      };
    }
    path.push({
      at: root.name,
      kind: "root",
      says: `${register.answersFor[0]?.toUpperCase()}${register.answersFor.slice(1)} are answered by the ${register.name}.`,
    });
    const entry = register.entries.find((e) => e.party === input.party) as RegisterEntry;
    const expires = new Date(Date.parse(input.at) + register.answerTtlMs).toISOString();
    const ok = entry.status === "authorized" && entry.authorizedFor.includes(input.task);
    path.push({
      at: register.name,
      kind: "register",
      says:
        entry.status !== "authorized"
          ? `${name(input.party)} is ${entry.status}. Checked ${input.at}.`
          : ok
            ? `${name(input.party)} is authorized for ${input.taskLabel}. Checked ${input.at}.`
            : `${name(input.party)} is authorized, but not for ${input.taskLabel}. Checked ${input.at}.`,
    });
    return {
      question,
      path,
      answer: ok ? `Accepted, for ${input.taskLabel} only.` : "Not accepted.",
      outcome: ok ? "accepted" : "not-accepted",
      checkedAt: input.at,
      expires,
      rule: { id: entry.id },
    };
  }
}
