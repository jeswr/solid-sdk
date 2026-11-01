// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assertResourceScope, emptyPolicy, subjectKey } from "./policy.js";
import type {
  AccessSystem,
  EffectivePolicy,
  Grant,
  OptionId,
  ReportItem,
  ReportKind,
  Resolutions,
  Subject,
} from "./types.js";
/** Trusted translation inputs and optional provenance for migration decision reports. */
export interface TranslationContext {
  scopeId?: string;
  sourceRules?: ReadonlyMap<string, string>;
  resourceUrl: string;
  targetOwner: string;
  sourceOwner: string;
  targetImplementation?: "css" | "ess" | "nss";
  groups: ReadonlyMap<string, readonly string[]>;
  sourceRuleTurtle?: string;
}
/** Stable descriptions for the migrator decision options. */
export const optionDescriptions: Record<OptionId, string> = {
  skip: "Leave this resource or unsupported grant out of the migration.",
  expand: "Grant only the listed current members; future membership changes will not follow.",
  "owner-only": "Copy with access reserved to the target owner.",
  "per-resource":
    "Write explicit controls on each existing descendant; new children receive no shared grants.",
  overwrite:
    "Replace the content conditionally and keep the target permissions, only if those are no wider than the source.",
  merge:
    "Add root resource grants while preserving the existing root document and member controls; requires a safe access proof.",
  "drop-overlapping": "Drop every grant clause that might overlap a denial.",
  abort: "Stop the migration without writing anything.",
  acknowledge: "Acknowledge this information; no decision is required.",
};
/** Create a stable decision or informational item for a resource and rule suffix. */
export function reportItem(
  kind: ReportKind,
  resourceUrl: string,
  explanation: string,
  options: OptionId[],
  suffix = "",
  sourceRuleTurtle?: string,
): ReportItem {
  return {
    id: `${kind}:${resourceUrl}:${suffix}`,
    kind,
    severity: options[0] === "acknowledge" ? "info" : "needs-decision",
    resourceUrl,
    title: kind.replaceAll("-", " "),
    explanation,
    sourceRuleTurtle,
    options: options.map((id) => ({
      id,
      label: id.replaceAll("-", " "),
      description: optionDescriptions[id],
    })),
    recommended: options[0] as OptionId,
  };
}
/**
 * Translate a resource-normalized policy; decisions select only narrowing alternatives.
 * Select resource and member inputs separately with scopePolicy and restore member scope on output.
 */
export function translatePolicy(
  source: EffectivePolicy,
  target: AccessSystem,
  context: TranslationContext,
  resolutions?: Resolutions,
): { policy: EffectivePolicy; report: ReportItem[] } {
  assertResourceScope(source);
  const policy = emptyPolicy();
  const report: ReportItem[] = [];
  const unestablished = (subject: Subject) =>
    (context.targetImplementation === "css" && subject.kind === "vc") ||
    (context.targetImplementation === "ess" &&
      (subject.kind === "client" || subject.kind === "issuer" || subject.kind === "vc"));
  let sourceRuleTurtle = context.sourceRuleTurtle;
  const choose = (
    kind: ReportKind,
    explanation: string,
    options: OptionId[],
    suffix: string,
  ): OptionId => {
    const item = reportItem(
      kind,
      context.resourceUrl,
      explanation,
      options,
      (context.scopeId ?? "") + suffix,
      sourceRuleTurtle,
    );
    report.push(item);
    return resolutions?.[item.id] ?? item.recommended;
  };
  for (const [ruleIndex, original] of source.grants.entries()) {
    sourceRuleTurtle = context.sourceRules?.get(original.source.url) ?? context.sourceRuleTurtle;
    if (target === "acp" && original.except.some(unestablished)) {
      choose(
        "exclusion-unsupported",
        "Target enforcement of this client, issuer or credential exclusion is not established. Omit the entire grant.",
        ["skip", "abort"],
        `${ruleIndex}:unestablished`,
      );
      continue;
    }
    if (original.except.some((subject) => subject.kind === "creator")) {
      choose(
        "exclusion-unsupported",
        "The original creator identity is unavailable. Omit the entire grant rather than weakening its exclusion.",
        ["skip", "abort"],
        `${ruleIndex}:creator`,
      );
      continue;
    }
    let clauses = original.who.map((clause) =>
      clause.map((subject) => {
        if (subject.kind === "owner" || subject.kind === "creator") {
          choose(
            "owner-mapped",
            "The source owner/creator role maps to the target owner WebID.",
            ["acknowledge"],
            `${ruleIndex}:${subject.kind}`,
          );
          return { kind: "agent", webId: context.targetOwner } as Subject;
        }
        if (subject.kind === "agent" && subject.webId === context.sourceOwner)
          choose(
            "source-owner-kept",
            "The source owner's WebID is kept verbatim.",
            ["acknowledge"],
            `${ruleIndex}`,
          );
        return subject;
      }),
    );
    if (clauses.some((c) => c.some((s) => s.kind === "origin"))) {
      choose(
        "origin-unsupported",
        "Origin enforcement is not established on any target; CSS 7.2 ignores acl:origin. Each origin-restricted clause is omitted.",
        ["skip", "abort"],
        `${ruleIndex}`,
      );
      clauses = clauses.filter((c) => !c.some((s) => s.kind === "origin"));
    }
    if (target === "acp") {
      if (clauses.some((clause) => clause.some(unestablished))) {
        choose(
          "condition-unsupported",
          "Target enforcement of this client, issuer or credential condition is not established. Omit the affected clauses.",
          ["skip", "abort"],
          `${ruleIndex}:unestablished`,
        );
        clauses = clauses.filter((clause) => !clause.some(unestablished));
      }
      for (const group of new Set(
        clauses
          .flat()
          .filter((s) => s.kind === "group")
          .map((s) => s.group),
      )) {
        const members = context.groups.get(group);
        const decision = choose(
          "group-unsupported",
          `ACP has no WAC groups. Publicly readable current members: ${members ? members.join(", ") || "(empty)" : "unavailable within the source pod fence"}.`,
          members ? ["skip", "expand", "abort"] : ["skip", "abort"],
          `${ruleIndex}:${group}`,
        );
        clauses = clauses.flatMap((clause) => {
          if (!clause.some((s) => s.kind === "group" && s.group === group)) return [clause];
          if (decision !== "expand" || !members) return [];
          return members.map((webId) =>
            clause.map((s) =>
              s.kind === "group" && s.group === group ? ({ kind: "agent", webId } as Subject) : s,
            ),
          );
        });
      }
    }
    if (target === "wac") {
      if (original.except.length) {
        choose(
          "exclusion-unsupported",
          "WAC cannot express these exclusions. The entire grant is omitted.",
          ["skip", "abort"],
          `${ruleIndex}`,
        );
        continue;
      }
      if (clauses.some((c) => c.some((s) => ["client", "issuer", "vc"].includes(s.kind)))) {
        choose(
          "condition-unsupported",
          "WAC cannot express client, issuer or credential conditions. The affected clauses are omitted.",
          ["skip", "abort"],
          `${ruleIndex}`,
        );
        clauses = clauses.filter(
          (c) => !c.some((s) => ["client", "issuer", "vc"].includes(s.kind)),
        );
      }
      // Intersections of distinct WAC principals cannot be represented by unioning them.
      clauses = clauses.flatMap((clause) => {
        const principals = clause.filter((s) => s.kind !== "origin" && s.kind !== "public");
        const unique = [...new Map(principals.map((s) => [subjectKey(s), s])).values()];
        if (unique.filter((subject) => subject.kind === "agent").length > 1) return [];
        if (unique.length > 1) {
          const agent = unique.find((s) => s.kind === "agent");
          if (agent && unique.every((s) => s.kind === "agent" || s.kind === "authenticated"))
            return [[agent, ...clause.filter((s) => s.kind === "origin")]];
          choose(
            "condition-unsupported",
            "This intersection of principals cannot be expressed in WAC; omit the clause.",
            ["skip", "abort"],
            `${ruleIndex}:intersection`,
          );
          return [];
        }
        return [
          [
            ...(unique.length ? unique : [{ kind: "public" } as Subject]),
            ...clause.filter((s) => s.kind === "origin"),
          ],
        ];
      });
    }
    const grant: Grant = {
      ...original,
      who: clauses,
      except: original.except.map((subject) =>
        subject.kind === "owner" ? { kind: "agent", webId: context.sourceOwner } : subject,
      ),
      appliesTo: "resource",
    };
    if (target === "wac")
      for (const [denyIndex, denial] of source.denials.entries()) {
        const covered = denial.who
          .filter((c) => !denial.except.length && c.length === 1)
          .map((c) => subjectKey(c[0] as Subject));
        const before = grant.who;
        const remainingModes = new Set(grant.modes);
        const overlaps = [...grant.modes].some((mode) => denial.modes.has(mode));
        if (!overlaps) continue;
        const exact = before.every(
          (c) =>
            c.some((s) => s.kind === "public" && covered.includes(subjectKey(s))) ||
            c.some((s) => covered.includes(subjectKey(s))) ||
            covered.includes(subjectKey({ kind: "public" })),
        );
        if (exact) {
          for (const mode of denial.modes) remainingModes.delete(mode);
          grant.modes = remainingModes;
        } else {
          choose(
            "deny-unsupported",
            "The denial cannot be subtracted faithfully. Drop every possibly overlapping grant clause.",
            ["drop-overlapping", "abort"],
            `${ruleIndex}:${denyIndex}`,
          );
          // Conservative overlap: retain only clauses with provably distinct concrete agents.
          grant.who = grant.who.filter((clause) => {
            const agent = clause.find((s) => s.kind === "agent");
            return (
              agent &&
              denial.who.every((c) => c.some((s) => s.kind === "agent" && s.webId !== agent.webId))
            );
          });
        }
      }
    if (grant.who.length && grant.modes.size) policy.grants.push(grant);
  }
  if (target === "acp") {
    for (const [index, rule] of source.denials.entries()) {
      sourceRuleTurtle = context.sourceRules?.get(rule.source.url) ?? context.sourceRuleTurtle;
      if (
        context.targetImplementation === "ess" &&
        [...rule.who.flat(), ...rule.except].some(unestablished)
      )
        choose(
          "deny-unsupported",
          "ESS client, issuer and credential target conditions are outside the allowlist. Apply this denial without those conditions or exclusions.",
          ["drop-overlapping", "abort"],
          `unestablished:${index}`,
        );
      if (
        rule.who
          .flat()
          .some(
            (subject) =>
              subject.kind === "creator" ||
              (context.targetImplementation === "css" && subject.kind === "vc"),
          )
      ) {
        choose(
          "deny-unsupported",
          "The target cannot establish this denial's creator or credential condition. Drop grants of every possibly denied mode.",
          ["drop-overlapping", "abort"],
          `creator:${index}`,
        );
        policy.grants = policy.grants.map((grant) => ({
          ...grant,
          modes: new Set([...grant.modes].filter((mode) => !rule.modes.has(mode))),
        }));
      } else
        policy.denials.push({
          ...rule,
          modes:
            rule.modes.has("append") || rule.modes.has("write")
              ? new Set([...rule.modes, "write", "append"])
              : rule.modes,
          who: rule.who.map((clause) => {
            const subjects = clause
              .filter((subject) => !unestablished(subject))
              .map<Subject>((subject) =>
                subject.kind === "owner" ? { kind: "agent", webId: context.sourceOwner } : subject,
              );
            return subjects.length ? subjects : [{ kind: "public" }];
          }),
          appliesTo: "resource",
          except: [
            ...rule.except
              .filter((subject) => subject.kind !== "creator" && !unestablished(subject))
              .map((subject) =>
                subject.kind === "owner"
                  ? { kind: "agent" as const, webId: context.sourceOwner }
                  : subject,
              ),
            { kind: "agent", webId: context.targetOwner },
          ],
        });
    }
  }
  return { policy, report };
}
