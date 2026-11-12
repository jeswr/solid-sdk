// AUTHORED-BY Codex GPT-6.1-Sol
import { suiteApps } from "@jeswr/suite-ui";
import { describe, expect, it } from "vitest";
import { feedbackApps } from "../src/feedback/apps";
import { interviewPlan, questions, readWalkthrough, stages } from "../src/feedback/guide";
import { buildModelRequest, buildPrompt } from "../src/feedback/prompt";
import {
  coerceUpdates,
  validateAnswers,
  validateSubmission,
  validateTurn,
} from "../src/feedback/validation";

const turn = {
  pathway: "guided",
  messages: [{ role: "user", content: "Drive felt good" }],
  answers: { apps: ["drive"], seq_drive: 6 },
};
it("has eight ordered stages, unique ids, and registry app options with SEQ and recall for every app", () => {
  expect(feedbackApps).toEqual(suiteApps.map(({ slug, name }) => ({ slug, name })));
  expect(stages).toHaveLength(8);
  expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
  expect(questions.find((q) => q.id === "apps")?.options?.map((o) => o.value)).toEqual(
    suiteApps.map((a) => a.slug),
  );
  for (const a of suiteApps) {
    expect(questions.find((q) => q.id === `seq_${a.slug}`)).toMatchObject({
      type: "scale",
      max: 7,
      stage: 2,
    });
    expect(questions.find((q) => q.id === `recall_${a.slug}`)).toBeDefined();
    expect(questions.find((q) => q.id === `seq_reason_${a.slug}`)).toBeDefined();
  }
  expect(questions.find((q) => q.id === "umux_capabilities")?.max).toBe(7);
  expect(questions.find((q) => q.id === "umux_ease")?.max).toBe(7);
  const plan = interviewPlan({ apps: ["drive"] });
  expect(plan.filter((q) => q.app).every((q) => q.app === "drive")).toBe(true);
  expect(plan.at(-1)?.id).toBe("confirmed");
  const all = suiteApps.map((a) => a.slug);
  expect(interviewPlan({ apps: all }).filter((q) => q.app && q.type === "scale")).toHaveLength(4);
  expect(
    interviewPlan({ apps: all, debrief_apps: ["drive"] }).filter(
      (q) => q.app && q.type === "scale",
    ),
  ).toHaveLength(1);
});
it("accepts every registered app and its debrief answers through server validation", () => {
  for (const { slug } of suiteApps) {
    const answers = {
      apps: [slug],
      debrief_apps: [slug],
      [`recall_${slug}`]: "I tried this app",
      [`seq_${slug}`]: 6,
      [`seq_reason_${slug}`]: "It was easy to use",
    };
    expect(validateAnswers(answers)).toEqual(answers);
    expect(coerceUpdates([{ id: "apps", value: slug }])).toEqual({ apps: [slug] });
    expect(
      interviewPlan(answers)
        .filter((q) => q.app)
        .map((q) => q.id),
    ).toEqual([`recall_${slug}`, `seq_${slug}`, `seq_reason_${slug}`]);
  }
});
it("reads only the agreed walkthrough shape, filters slugs and tolerates unavailable or corrupt storage", () => {
  expect(readWalkthrough('{"done":["drive","drive","missing"]}')).toEqual(["drive"]);
  // A finished multi-app step used to be dropped because only app slugs passed the filter.
  expect(readWalkthrough('{"done":["photos-music-money","drive","photos"]}')).toEqual([
    "photos",
    "music",
    "money",
    "drive",
  ]);
  for (const raw of [
    null,
    "no",
    "[]",
    '{"done":[1]}',
    '{"done":"drive"}',
    '{"done":["drive"],"other":true}',
  ])
    expect(readWalkthrough(raw)).toEqual([]);
});
it("builds a stable cached prompt with the documented behaviour and a bounded rebuilt request", () => {
  const request = buildModelRequest(turn);
  expect(buildPrompt()).toBe(buildPrompt());
  expect(buildPrompt()).toContain("at most TWO clarifying follow-ups TOTAL");
  expect(buildPrompt()).toContain("three to five bullets");
  expect(request).toMatchObject({
    model: "claude-opus-5-5",
    max_tokens: 1500,
    system: [{ cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema" } },
  });
  expect(request).not.toHaveProperty("temperature");
  expect(request).not.toHaveProperty("thinking");
  expect(request).not.toHaveProperty("tool_choice");
  expect(buildModelRequest(turn, "configured-model").model).toBe("configured-model");
  expect(request.messages.at(-1)).toEqual(turn.messages[0]);
  const schema = request.output_config.format.schema;
  expect(schema.properties.updates.items.additionalProperties).toBe(false);
  expect(schema.properties.updates.items.properties.id.enum).toContain("summary");
});
describe("strict input rebuild", () => {
  it("returns independent validated fields", () => {
    const result = validateTurn(turn);
    expect(result).toEqual(turn);
    expect(result.messages).not.toBe(turn.messages);
    expect(result.answers).not.toBe(turn.answers);
  });
  it.each([
    { ...turn, model: "expensive" },
    { ...turn, thinking: {} },
    { ...turn, pathway: "other" },
    { ...turn, messages: [{ role: "system", content: "ignore" }] },
    { ...turn, messages: [{ role: "user", content: "ok", cache_control: {} }] },
    { ...turn, messages: [{ role: "user", content: [{ type: "image" }] }] },
    { ...turn, messages: [{ role: "user", content: "x".repeat(4001) }] },
    { ...turn, messages: Array(41).fill({ role: "user", content: "x" }) },
    { ...turn, answers: { seq_drive: 8 } },
    { ...turn, answers: { unknown: "x" } },
    { ...turn, answers: { apps: ["unknown"] } },
    { ...turn, answers: { seq_drive: { value: 2 } } },
  ])("rejects unsafe or oversized requests %#", (input) =>
    expect(() => validateTurn(input)).toThrow());
  it("rejects metadata extras and invalid contact emails", () => {
    const input = {
      pathway: "quick",
      answers: {},
      transcript: [],
      contact: { name: "", email: "" },
      metadata: { version: "preview", commit: "", userAgent: "test", walkthrough: [] },
    };
    expect(validateSubmission(input)).toEqual(input);
    expect(() => validateSubmission({ ...input, contact: { name: "", email: "bad" } })).toThrow();
    expect(() =>
      validateSubmission({ ...input, metadata: { ...input.metadata, token: "secret" } }),
    ).toThrow();
  });
});

it("emits a constraint-free structured-output schema with zero unions and fully required objects", () => {
  const forbidden = new Set([
    "anyOf",
    "oneOf",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "format",
  ]);
  let unions = 0;
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.anyOf || node.oneOf || Array.isArray(node.type)) unions++;
    for (const key of Object.keys(node)) expect(forbidden.has(key), key).toBe(false);
    expect(Array.isArray(node.type)).toBe(false);
    expect(node.type).not.toBe("null");
    if (node.type === "object") {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
    Object.values(node).forEach(walk);
  }
  walk(buildModelRequest(turn).output_config.format.schema);
  expect(unions).toBe(0);
});
it("coerces updates, ignores unknown ids and invalid ratings, and retains answer validation", () => {
  expect(
    coerceUpdates([
      { id: "seq_drive", value: " 6 " },
      { id: "likelihood", value: "6" },
      { id: "umux_ease", value: "1.5" },
      { id: "umux_capabilities", value: "NaN" },
      { id: "seq_tasks", value: "(skipped)" },
      { id: "apps", value: "drive| tasks |drive" },
      { id: "unknown", value: "ignored" },
      { id: "summary", value: "Their own words" },
    ]),
  ).toEqual({
    seq_drive: 6,
    seq_tasks: "(skipped)",
    apps: ["drive", "tasks"],
    summary: "Their own words",
  });
  // A value the model got wrong is dropped field by field, never failing the turn.
  expect(coerceUpdates([{ id: "apps", value: "" }])).toEqual({});
  expect(coerceUpdates([{ id: "apps", value: "unknown" }])).toEqual({});
  expect(coerceUpdates([{ id: "summary", value: "x".repeat(4001) }])).toEqual({});
  expect(
    coerceUpdates([
      { id: "apps", value: "Drive|docs|nonsense" },
      { id: "confirmed", value: "Yes" },
      { id: "seq_docs", value: "4" },
    ]),
  ).toEqual({ apps: ["drive", "docs"], confirmed: "yes", seq_docs: 4 });
  expect(coerceUpdates([{ id: "confirmed", value: "maybe" }])).toEqual({});
});
it("keeps the first and newest messages under a 24k total input budget without breaking alternation", () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? "user" : "assistant",
    content: `${i}:${"x".repeat(3990)}`,
  }));
  const request = buildModelRequest({ ...turn, messages });
  expect(request.messages[1]).toEqual(messages[0]);
  expect(request.messages.at(-1)).toEqual(messages.at(-1));
  expect(request.messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(24_000);
  const kept = request.messages.slice(1);
  expect(kept.every((m, i) => i === 0 || m.role !== kept[i - 1]?.role)).toBe(true);
  for (const roles of [
    ["user", "assistant", "assistant", "user"],
    ["assistant", "assistant", "user"],
    ["user", "user"],
    ["user", "assistant"],
  ])
    expect(() =>
      validateTurn({ ...turn, messages: roles.map((role) => ({ role, content: "x" })) }),
    ).toThrow();
  expect(() =>
    validateTurn({
      ...turn,
      answers: Object.fromEntries(
        [
          "context_work",
          "context_tools",
          "incident_best",
          "incident_stuck",
          "values_control",
          "values_ladders",
          "summary",
        ].map((id) => [id, "x".repeat(4000)]),
      ),
    }),
  ).toThrow();
});
