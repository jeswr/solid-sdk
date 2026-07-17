// AUTHORED-BY Claude Fable 5
/**
 * Document validation beyond the type shapes: registry resolution, chapter contiguity,
 * editorial budgets, compliance cross-references, honesty floors. Every issue names the
 * chapter/step/role/check it comes from, and `parseWalkthrough` reports ALL issues at
 * once rather than failing on the first.
 */
import type { ZodError } from "zod";
import {
  type EditorialLimits,
  type WalkthroughChapter,
  type WalkthroughDocument,
  walkthroughDocumentSchema,
} from "./schema.js";

/** One validation failure, with a stable machine code and a human message. */
export interface WalkthroughIssue {
  /** Stable rule identifier, e.g. "unknown-try-live-app". */
  code: string;
  /** Dotted location, e.g. `chapters[pack-the-vault].steps[1].tryLive.app`. */
  path: string;
  message: string;
}

/** Thrown by {@link parseWalkthrough}; carries every issue found. */
export class WalkthroughValidationError extends Error {
  readonly issues: readonly WalkthroughIssue[];

  constructor(issues: readonly WalkthroughIssue[]) {
    super(
      `Invalid walkthrough document (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${issues
        .map((issue) => `- [${issue.code}] ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "WalkthroughValidationError";
    this.issues = issues;
  }
}

/** Editorial limits with the defaults applied. */
export interface ResolvedEditorialLimits {
  maxLeadWords: number;
  maxStepWords: number;
  minSteps: number;
  minUnderneathChars: number;
}

export const EDITORIAL_DEFAULTS: ResolvedEditorialLimits = Object.freeze({
  maxLeadWords: 40,
  maxStepWords: 65,
  minSteps: 2,
  minUnderneathChars: 20,
});

/** Apply the editorial defaults to a document's (possibly absent) overrides. */
export function resolveEditorial(editorial?: EditorialLimits): ResolvedEditorialLimits {
  return {
    maxLeadWords: editorial?.maxLeadWords ?? EDITORIAL_DEFAULTS.maxLeadWords,
    maxStepWords: editorial?.maxStepWords ?? EDITORIAL_DEFAULTS.maxStepWords,
    minSteps: editorial?.minSteps ?? EDITORIAL_DEFAULTS.minSteps,
    minUnderneathChars: editorial?.minUnderneathChars ?? EDITORIAL_DEFAULTS.minUnderneathChars,
  };
}

export function countWords(text: string): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/** One editorial budget violation. */
export interface EditorialFinding {
  chapterSlug: string;
  scene: number;
  rule: "lead-budget" | "step-budget" | "min-steps" | "underneath-required" | "underneath-length";
  /** Step title, for step-level findings. */
  stepTitle?: string;
  limit: number;
  actual: number;
  message: string;
}

/**
 * Machine-enforced editorial gates: a chapter cannot ship a bloated lead or step, too few
 * steps, or a missing/thin "underneath" panel where one is required. Empty result =
 * publishable.
 */
export function editorialFindings(doc: WalkthroughDocument): EditorialFinding[] {
  const limits = resolveEditorial(doc.editorial);
  const findings: EditorialFinding[] = [];

  for (const chapter of doc.chapters) {
    const name = `chapter "${chapter.slug}" (scene ${chapter.scene})`;
    const leadWords = countWords(chapter.lead);
    if (leadWords > limits.maxLeadWords) {
      findings.push({
        actual: leadWords,
        chapterSlug: chapter.slug,
        limit: limits.maxLeadWords,
        message: `${name}: lead is ${leadWords} words (max ${limits.maxLeadWords})`,
        rule: "lead-budget",
        scene: chapter.scene,
      });
    }
    if (chapter.steps.length < limits.minSteps) {
      findings.push({
        actual: chapter.steps.length,
        chapterSlug: chapter.slug,
        limit: limits.minSteps,
        message: `${name}: has ${chapter.steps.length} step(s) (min ${limits.minSteps})`,
        rule: "min-steps",
        scene: chapter.scene,
      });
    }
    for (const step of chapter.steps) {
      const bodyWords = countWords(step.body);
      if (bodyWords > limits.maxStepWords) {
        findings.push({
          actual: bodyWords,
          chapterSlug: chapter.slug,
          limit: limits.maxStepWords,
          message: `${name}, step "${step.title}": body is ${bodyWords} words (max ${limits.maxStepWords})`,
          rule: "step-budget",
          scene: chapter.scene,
          stepTitle: step.title,
        });
      }
    }
    if (chapter.underneathRequired === true) {
      const underneath = chapter.underneath ?? [];
      if (underneath.length === 0) {
        findings.push({
          actual: 0,
          chapterSlug: chapter.slug,
          limit: 1,
          message: `${name}: underneathRequired is set but "underneath" is missing or empty`,
          rule: "underneath-required",
          scene: chapter.scene,
        });
      }
      for (const point of underneath) {
        if (point.length < limits.minUnderneathChars) {
          findings.push({
            actual: point.length,
            chapterSlug: chapter.slug,
            limit: limits.minUnderneathChars,
            message: `${name}: underneath point "${point}" is ${point.length} chars (min ${limits.minUnderneathChars})`,
            rule: "underneath-length",
            scene: chapter.scene,
          });
        }
      }
    }
  }

  return findings;
}

function chapterName(chapter: WalkthroughChapter): string {
  return `chapter "${chapter.slug}" (scene ${chapter.scene})`;
}

function crossValidationIssues(doc: WalkthroughDocument): WalkthroughIssue[] {
  const issues: WalkthroughIssue[] = [];
  const { registry, chapters, compliance, persona } = doc;
  const appKeys = new Set(Object.keys(registry.apps));

  // Every registry.apps record key equals its entry's slug.
  for (const [key, app] of Object.entries(registry.apps)) {
    if (key !== app.slug) {
      issues.push({
        code: "registry-key-mismatch",
        message: `registry.apps["${key}"] declares slug "${app.slug}" — record keys must equal their entry's slug`,
        path: `registry.apps[${key}].slug`,
      });
    }
  }

  // Every launcherOrder entry resolves; no duplicates.
  const seenLauncher = new Set<string>();
  registry.launcherOrder.forEach((slug, index) => {
    if (!appKeys.has(slug)) {
      issues.push({
        code: "unknown-launcher-app",
        message: `launcherOrder[${index}] "${slug}" is not a key of registry.apps`,
        path: `registry.launcherOrder[${index}]`,
      });
    }
    if (seenLauncher.has(slug)) {
      issues.push({
        code: "duplicate-launcher-app",
        message: `launcherOrder[${index}] "${slug}" appears more than once`,
        path: `registry.launcherOrder[${index}]`,
      });
    }
    seenLauncher.add(slug);
  });

  // Role slugs unique; every roles[].apps[] resolves; exactly one centre role matching
  // registry.center; every roles[].scene names an existing chapter scene.
  const sceneNumbers = new Set(chapters.map((chapter) => chapter.scene));
  const seenRoleSlugs = new Set<string>();
  const centerRoles: string[] = [];
  registry.roles.forEach((role, index) => {
    if (seenRoleSlugs.has(role.slug)) {
      issues.push({
        code: "duplicate-role-slug",
        message: `role "${role.slug}" (roles[${index}]) duplicates an earlier role slug`,
        path: `registry.roles[${index}].slug`,
      });
    }
    seenRoleSlugs.add(role.slug);
    if (role.center === true) centerRoles.push(role.slug);
    for (const appSlug of role.apps) {
      if (!appKeys.has(appSlug)) {
        issues.push({
          code: "unknown-role-app",
          message: `role "${role.slug}" lists app "${appSlug}", which is not a key of registry.apps`,
          path: `registry.roles[${index}].apps`,
        });
      }
    }
    if (role.scene !== undefined && !sceneNumbers.has(role.scene)) {
      issues.push({
        code: "unknown-role-scene",
        message: `role "${role.slug}" names scene ${role.scene}, but no chapter has that scene`,
        path: `registry.roles[${index}].scene`,
      });
    }
  });
  if (centerRoles.length !== 1 || centerRoles[0] !== registry.center) {
    issues.push({
      code: "center-role",
      message:
        centerRoles.length === 0
          ? `no role has center: true (registry.center is "${registry.center}")`
          : centerRoles.length > 1
            ? `multiple roles claim center: true (${centerRoles.map((slug) => `"${slug}"`).join(", ")})`
            : `the centre role is "${centerRoles[0]}" but registry.center is "${registry.center}"`,
      path: "registry.center",
    });
  }

  // Chapter scene numbers contiguous 1..N in array order; slugs unique.
  const seenChapterSlugs = new Set<string>();
  chapters.forEach((chapter, index) => {
    if (chapter.scene !== index + 1) {
      issues.push({
        code: "chapter-scene-order",
        message: `${chapterName(chapter)} is at position ${index} — scenes must be contiguous 1..N in array order (expected scene ${index + 1})`,
        path: `chapters[${index}].scene`,
      });
    }
    if (seenChapterSlugs.has(chapter.slug)) {
      issues.push({
        code: "duplicate-chapter-slug",
        message: `${chapterName(chapter)} duplicates an earlier chapter slug`,
        path: `chapters[${index}].slug`,
      });
    }
    seenChapterSlugs.add(chapter.slug);

    // Every steps[].tryLive.app resolves in registry.apps.
    chapter.steps.forEach((step, stepIndex) => {
      if (!appKeys.has(step.tryLive.app)) {
        issues.push({
          code: "unknown-try-live-app",
          message: `${chapterName(chapter)}, step ${stepIndex + 1} "${step.title}": tryLive.app "${step.tryLive.app}" is not a key of registry.apps`,
          path: `chapters[${index}].steps[${stepIndex}].tryLive.app`,
        });
      }
    });
  });

  // compliance.checks[].chapterSlug resolves AND the check's scene equals that chapter's.
  if (compliance !== undefined) {
    const chaptersBySlug = new Map(chapters.map((chapter) => [chapter.slug, chapter]));
    compliance.checks.forEach((check, index) => {
      const chapter = chaptersBySlug.get(check.chapterSlug);
      if (chapter === undefined) {
        issues.push({
          code: "unknown-compliance-chapter",
          message: `compliance check "${check.id}" references chapter "${check.chapterSlug}", which does not exist`,
          path: `compliance.checks[${index}].chapterSlug`,
        });
      } else if (chapter.scene !== check.scene) {
        issues.push({
          code: "compliance-scene-mismatch",
          message: `compliance check "${check.id}" says scene ${check.scene}, but ${chapterName(chapter)} has scene ${chapter.scene}`,
          path: `compliance.checks[${index}].scene`,
        });
      }
    });
  }

  // Honesty floor: the persona must self-identify as fictional/simulated.
  const descriptor = persona.descriptor.toLowerCase();
  if (!(descriptor.includes("fictional") || descriptor.includes("simulated"))) {
    issues.push({
      code: "persona-honesty",
      message: `persona.descriptor must contain "fictional" or "simulated" — got "${persona.descriptor}"`,
      path: "persona.descriptor",
    });
  }

  return issues;
}

function zodErrorToIssues(error: ZodError): WalkthroughIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return {
      // Editorial overrides below the schema floors get their own stable code — the
      // floors (minSteps ≥ 2, minUnderneathChars ≥ 20) are pinned in the schema itself.
      code: issue.path[0] === "editorial" ? "editorial-floor" : "schema",
      message: issue.message,
      path,
    };
  });
}

/**
 * Validate an untrusted JSON value as a walkthrough document. Enforces the full rule
 * table: shape (zod), registry resolution, launcher/role/centre integrity, chapter
 * contiguity, editorial budgets, compliance cross-references, and the persona honesty
 * floor. Throws {@link WalkthroughValidationError} carrying EVERY issue, each with a
 * stable code and a chapter/step-naming message.
 */
export function parseWalkthrough(json: unknown): WalkthroughDocument {
  const parsed = walkthroughDocumentSchema.safeParse(json);
  if (!parsed.success) {
    throw new WalkthroughValidationError(zodErrorToIssues(parsed.error));
  }
  const doc = parsed.data;
  const issues = crossValidationIssues(doc);
  for (const finding of editorialFindings(doc)) {
    issues.push({
      code: finding.rule,
      message: finding.message,
      path:
        finding.stepTitle === undefined
          ? `chapters[${finding.chapterSlug}]`
          : `chapters[${finding.chapterSlug}].steps["${finding.stepTitle}"]`,
    });
  }
  if (issues.length > 0) throw new WalkthroughValidationError(issues);
  return doc;
}

/**
 * Non-fatal advisories: currently the role-first naming rule — an app's display name
 * must not embed the organisation it is modelled on ("modelled on X", never "X app").
 */
export function walkthroughWarnings(doc: WalkthroughDocument): WalkthroughIssue[] {
  const warnings: WalkthroughIssue[] = [];
  for (const [key, app] of Object.entries(doc.registry.apps)) {
    const modelledOn = app.modelledOn.trim().toLowerCase();
    if (modelledOn.length > 0 && app.appName.toLowerCase().includes(modelledOn)) {
      warnings.push({
        code: "role-first-app-name",
        message: `app "${key}": appName "${app.appName}" contains modelledOn "${app.modelledOn}" — name apps role-first, never after the modelled organisation`,
        path: `registry.apps[${key}].appName`,
      });
    }
  }
  return warnings;
}
