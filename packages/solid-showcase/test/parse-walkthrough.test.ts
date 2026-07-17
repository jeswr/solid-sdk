// AUTHORED-BY Claude Fable 5
/**
 * Malformed-document suite: one DISTINCT rejection per validation invariant, each
 * asserting the stable issue code AND that the message names the offending
 * chapter/step/role/check.
 */
import { describe, expect, test } from "vitest";
import type { WalkthroughDocument } from "../src/index.js";
import {
  editorialFindings,
  parseWalkthrough,
  WalkthroughValidationError,
  walkthroughWarnings,
} from "../src/index.js";
import { cloneExample, exampleWalkthrough } from "./support/example-document.js";

function issuesOf(doc: unknown) {
  try {
    parseWalkthrough(doc);
  } catch (error) {
    if (error instanceof WalkthroughValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected parseWalkthrough to reject the document");
}

function expectIssue(doc: unknown, code: string, messagePart: string | RegExp) {
  const issues = issuesOf(doc);
  const matching = issues.filter((issue) => issue.code === code);
  expect(
    matching,
    `expected an issue with code "${code}" in:\n${JSON.stringify(issues, null, 2)}`,
  ).not.toHaveLength(0);
  const [issue] = matching;
  if (typeof messagePart === "string") {
    expect(issue?.message).toContain(messagePart);
  } else {
    expect(issue?.message).toMatch(messagePart);
  }
}

test("the example document parses, returns the document, and has no editorial findings", () => {
  const doc = parseWalkthrough(structuredClone(exampleWalkthrough) as unknown);
  expect(doc.site.appName).toBe(exampleWalkthrough.site.appName);
  expect(editorialFindings(doc)).toEqual([]);
  expect(walkthroughWarnings(doc)).toEqual([]);
});

describe("each invariant gets a distinct rejection", () => {
  test("unknown try-live app", () => {
    const doc = cloneExample();
    const step = doc.chapters[0]?.steps[1];
    if (step === undefined) throw new Error("fixture drift");
    step.tryLive.app = "no-such-app";
    expectIssue(doc, "unknown-try-live-app", 'chapter "pack-the-vault"');
    expectIssue(doc, "unknown-try-live-app", '"no-such-app"');
  });

  test("roles[].apps[] unresolved", () => {
    const doc = cloneExample();
    doc.registry.roles[1]?.apps.push("ghost-app");
    expectIssue(doc, "unknown-role-app", 'role "permit-authority"');
  });

  test("launcherOrder entry unresolved", () => {
    const doc = cloneExample();
    doc.registry.launcherOrder.push("phantom");
    expectIssue(doc, "unknown-launcher-app", '"phantom"');
  });

  test("launcherOrder entry duplicated", () => {
    const doc = cloneExample();
    doc.registry.launcherOrder.push("vault");
    expectIssue(doc, "duplicate-launcher-app", '"vault"');
  });

  test("registry record key ≠ entry slug", () => {
    const doc = cloneExample();
    const vault = doc.registry.apps.vault;
    if (vault === undefined) throw new Error("fixture drift");
    vault.slug = "vault-renamed";
    expectIssue(doc, "registry-key-mismatch", 'registry.apps["vault"]');
  });

  test("duplicate role slug", () => {
    const doc = cloneExample();
    const stewards = doc.registry.roles[4];
    if (stewards === undefined) throw new Error("fixture drift");
    stewards.slug = "outfitting";
    expectIssue(doc, "duplicate-role-slug", '"outfitting"');
  });

  test("no centre role / centre mismatch", () => {
    const noCentre = cloneExample();
    const traveller = noCentre.registry.roles[0];
    if (traveller === undefined) throw new Error("fixture drift");
    traveller.center = undefined;
    expectIssue(noCentre, "center-role", "no role has center: true");

    const mismatch = cloneExample();
    mismatch.registry.center = "stewards";
    expectIssue(mismatch, "center-role", '"stewards"');
  });

  test("roles[].scene with no matching chapter", () => {
    const doc = cloneExample();
    const role = doc.registry.roles[2];
    if (role === undefined) throw new Error("fixture drift");
    role.scene = 9;
    expectIssue(doc, "unknown-role-scene", 'role "outfitting" names scene 9');
  });

  test("non-contiguous chapter scenes", () => {
    const doc = cloneExample();
    const last = doc.chapters[2];
    if (last === undefined) throw new Error("fixture drift");
    last.scene = 5;
    expectIssue(doc, "chapter-scene-order", 'chapter "share-the-route"');
    expectIssue(doc, "chapter-scene-order", "expected scene 3");
  });

  test("lead budget overrun", () => {
    const doc = cloneExample();
    const chapter = doc.chapters[1];
    if (chapter === undefined) throw new Error("fixture drift");
    chapter.lead = Array.from({ length: 41 }, (_, index) => `word${index}`).join(" ");
    expectIssue(doc, "lead-budget", 'chapter "prove-the-permit"');
    expectIssue(doc, "lead-budget", "41 words (max 40)");
  });

  test("step budget overrun", () => {
    const doc = cloneExample();
    const step = doc.chapters[1]?.steps[0];
    if (step === undefined) throw new Error("fixture drift");
    step.body = Array.from({ length: 66 }, (_, index) => `word${index}`).join(" ");
    expectIssue(doc, "step-budget", 'step "Issue the day permit"');
  });

  test("minSteps (tightened override) violation", () => {
    const doc = cloneExample();
    doc.editorial = { minSteps: 3 };
    expectIssue(doc, "min-steps", "min 3");
  });

  test("required underneath missing", () => {
    const doc = cloneExample();
    const chapter = doc.chapters[0];
    if (chapter === undefined) throw new Error("fixture drift");
    chapter.underneath = undefined;
    expectIssue(doc, "underneath-required", 'chapter "pack-the-vault"');
  });

  test("required underneath point too short (tightened override)", () => {
    const doc = cloneExample();
    doc.editorial = { minUnderneathChars: 200 };
    expectIssue(doc, "underneath-length", 'chapter "pack-the-vault"');
    expectIssue(doc, "underneath-length", "min 200");
  });

  test("compliance chapterSlug unresolved", () => {
    const doc = cloneExample();
    const check = doc.compliance?.checks[0];
    if (check === undefined) throw new Error("fixture drift");
    check.chapterSlug = "missing-chapter";
    expectIssue(doc, "unknown-compliance-chapter", 'check "day-permit"');
  });

  test("compliance scene ≠ referenced chapter's scene", () => {
    const doc = cloneExample();
    const check = doc.compliance?.checks[1];
    if (check === undefined) throw new Error("fixture drift");
    check.scene = 1;
    expectIssue(doc, "compliance-scene-mismatch", 'check "route-notice"');
    expectIssue(doc, "compliance-scene-mismatch", "scene 3");
  });

  test("editorial override below a schema floor", () => {
    const belowSteps = cloneExample();
    belowSteps.editorial = { minSteps: 1 };
    const issues = issuesOf(belowSteps);
    const floor = issues.find((issue) => issue.code === "editorial-floor");
    expect(floor?.path).toBe("editorial.minSteps");

    const belowChars = cloneExample();
    belowChars.editorial = { minUnderneathChars: 10 };
    expect(issuesOf(belowChars).find((issue) => issue.code === "editorial-floor")?.path).toBe(
      "editorial.minUnderneathChars",
    );
  });

  test('persona descriptor missing "fictional"/"simulated"', () => {
    const doc = cloneExample();
    doc.persona.descriptor = "A traveller from the north ranges.";
    expectIssue(doc, "persona-honesty", "persona.descriptor");
  });
});

test("all issues are reported at once, not first-failure-only", () => {
  const doc = cloneExample();
  doc.registry.launcherOrder.push("phantom", "vault");
  doc.persona.descriptor = "A traveller.";
  const codes = new Set(issuesOf(doc).map((issue) => issue.code));
  expect(codes).toEqual(
    new Set(["unknown-launcher-app", "duplicate-launcher-app", "persona-honesty"]),
  );
});

test("editorialFindings reports budgets without throwing", () => {
  const doc = cloneExample();
  const chapter = doc.chapters[0];
  if (chapter === undefined) throw new Error("fixture drift");
  chapter.lead = Array.from({ length: 50 }, () => "word").join(" ");
  const findings = editorialFindings(doc as WalkthroughDocument);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    actual: 50,
    chapterSlug: "pack-the-vault",
    limit: 40,
    rule: "lead-budget",
    scene: 1,
  });
});

test("role-first naming violations surface as warnings, not errors", () => {
  const doc = cloneExample();
  const vault = doc.registry.apps.vault;
  if (vault === undefined) throw new Error("fixture drift");
  vault.appName = "Cairn Cooperative Vault";
  const parsed = parseWalkthrough(doc as unknown);
  const warnings = walkthroughWarnings(parsed);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.code).toBe("role-first-app-name");
  expect(warnings[0]?.message).toContain("Cairn Cooperative");
});

test("non-object input is rejected with schema issues", () => {
  const issues = issuesOf("not a document");
  expect(issues[0]?.code).toBe("schema");
});
