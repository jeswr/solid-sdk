// AUTHORED-BY Codex GPT-6.1-Sol
import { suiteApps } from "@jeswr/suite-ui";
import { describe, expect, it } from "vitest";
import { feedbackApps } from "../src/feedback/apps";
import { interviewPlan, questions, readWalkthrough, stages } from "../src/feedback/guide";
import { buildModelRequest, buildPrompt } from "../src/feedback/prompt";
import { validateSubmission, validateTurn } from "../src/feedback/validation";

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
it("reads only the agreed walkthrough shape, filters slugs and tolerates unavailable or corrupt storage", () => {
  expect(readWalkthrough('{"done":["drive","drive","missing"]}')).toEqual(["drive"]);
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
    max_tokens: 4000,
    system: [{ cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema" } },
  });
  expect(request).not.toHaveProperty("temperature");
  expect(request).not.toHaveProperty("thinking");
  expect(request).not.toHaveProperty("tool_choice");
  expect(buildModelRequest(turn, "configured-model").model).toBe("configured-model");
  expect(request.messages.at(-1)).toEqual(turn.messages[0]);
  const schema = request.output_config.format.schema;
  expect(schema.properties.answers.additionalProperties).toBe(false);
  expect(schema.properties.answers.required).toContain("summary");
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
