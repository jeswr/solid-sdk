// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { answerText, responsesCsv } from "../src/apps/forms/lib/csv";
import {
  designerIssues,
  duplicateQuestion,
  fillLink,
  moveQuestion,
  newForm,
  newQuestion,
  type QuestionKind,
} from "../src/apps/forms/lib/designer";
import { createFakeRuntime } from "../src/apps/forms/lib/fake-runtime";
import type { FieldDescriptor, FormModel, FormValues } from "../src/apps/forms/lib/runtime";
import { formRuntime } from "../src/apps/forms/lib/runtime";

const runtime = createFakeRuntime();
const shape = "https://author.example/forms/a.ttl#form";
const subject = "https://respondent.example/forms/responses/a.ttl#response";
const model = (field: FieldDescriptor): FormModel => ({ ...newForm(shape), fields: [field] });
const field = (kind: QuestionKind, extra: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  ...newQuestion("answer", kind),
  ...extra,
});

describe("JSON-only runtime double", () => {
  it("leaves production runtime installation to the parallel package", () => {
    expect(formRuntime.current).toBeNull();
    expect(formRuntime.openStore).toBeNull();
  });
  it.each([
    ["text", "hello", 12],
    ["multiline", "line one\nline two", true],
    ["integer", 2, 2.5],
    ["decimal", 2.5, Number.NaN],
    ["boolean", false, "false"],
    ["date", "2026-11-11", "2026-02-30"],
    ["dateTime", "2026-11-11T14:30:00Z", "yesterday"],
    ["iri", "https://example.org/reading", "javascript:alert(1)"],
    ["choice", "Option 1", "Other"],
  ] as const)("round trips %s and rejects the wrong value", async (kind, good, bad) => {
    const form = model(field(kind));
    const values = { q_answer: good };
    expect(runtime.validate(form, values).valid).toBe(true);
    const graph = runtime.build(form, subject, values);
    expect(runtime.parse(form, subject, graph)).toEqual(values);
    expect(JSON.parse(await runtime.serialize(graph))).toEqual({ subject, values });
    expect(runtime.validate(form, { q_answer: bad }).valid).toBe(false);
    expect(() => runtime.build(form, subject, { q_answer: bad })).toThrow();
    expect(runtime.parse(form, subject, { subject, values: { q_answer: bad } })).toEqual({});
  });
  it("round trips form JSON and refuses another shape or subject", () => {
    const form = model(field("text"));
    const graph = runtime.formToShapes(form);
    const copy = runtime.compileForm(graph, shape);
    copy.label = "changed";
    expect(form.label).toBe("Untitled form");
    expect(() => runtime.compileForm(graph, `${shape}bad`)).toThrow();
    expect(() => runtime.compileForm({ subject, values: {} }, shape)).toThrow();
    expect(runtime.parse(form, subject, graph)).toEqual({});
    expect(runtime.parse(form, subject, { subject: "other", values: {} })).toEqual({});
    expect(() => runtime.build(form, "urn:bad", {})).toThrow();
    expect(() => runtime.build(form, "relative", {})).toThrow();
  });
  it("keeps required false and zero, checks counts and optional absence", () => {
    expect(
      runtime.validate(model(field("boolean", { minCount: 1 })), { q_answer: false }).valid,
    ).toBe(true);
    expect(runtime.validate(model(field("integer", { minCount: 1 })), { q_answer: 0 }).valid).toBe(
      true,
    );
    for (const values of [{}, { q_answer: "" }, { q_answer: [] }])
      expect(runtime.validate(model(field("text", { minCount: 1 })), values).valid).toBe(false);
    expect(runtime.validate(model(field("text")), {}).valid).toBe(true);
    expect(
      runtime.validate(model(field("text")), { q_answer: ["a", "b"] }).issues[0]?.message,
    ).toMatch(/too many/);
    expect(
      runtime.validate(model(field("text", { maxCount: 2 })), { q_answer: ["a", "b"] }).valid,
    ).toBe(true);
  });
  it("checks both boundaries and preserves advisory severities", () => {
    const text = model(field("text", { minLength: 2, maxLength: 3 }));
    expect(runtime.validate(text, { q_answer: "ab" }).valid).toBe(true);
    expect(runtime.validate(text, { q_answer: "abc" }).valid).toBe(true);
    expect(runtime.validate(text, { q_answer: "a" }).valid).toBe(false);
    expect(runtime.validate(text, { q_answer: "abcd" }).valid).toBe(false);
    const number = model(field("decimal", { minInclusive: -1, maxInclusive: 1 }));
    for (const value of [-1, 0, 1])
      expect(runtime.validate(number, { q_answer: value }).valid).toBe(true);
    for (const value of [-2, 2])
      expect(runtime.validate(number, { q_answer: value }).valid).toBe(false);
    for (const severity of ["warning", "info"] as const) {
      const result = runtime.validate(model(field("text", { minCount: 1, severity })), {});
      expect(result.valid).toBe(true);
      expect(result.issues[0]?.severity).toBe(severity);
    }
  });
  it("rejects unsupported nodes, invalid IRIs, absent options and unsafe integers", () => {
    for (const value of [
      "data:text/plain,hello",
      "not a url",
      "https://user:secret@example.org",
      false,
    ])
      expect(runtime.validate(model(field("iri")), { q_answer: value }).valid).toBe(false);
    expect(runtime.validate(model(field("iri")), { q_answer: "http://example.org" }).valid).toBe(
      true,
    );
    expect(
      runtime.validate(model({ ...field("text"), kind: "node" }), { q_answer: {} }).valid,
    ).toBe(false);
    const choice = field("choice");
    delete choice.options;
    expect(runtime.validate(model(choice), { q_answer: "Option 1" }).valid).toBe(false);
    expect(runtime.validate(model(field("integer")), { q_answer: 2 ** 53 }).valid).toBe(false);
    expect(runtime.parse(model(field("text")), subject, { subject, values: {} })).toEqual({});
    const values = Object.create({ q_answer: "inherited" }) as FormValues;
    expect(runtime.validate(model(field("text", { minCount: 1 })), values).valid).toBe(false);
  });
});

describe("designer operations", () => {
  it("deduplicates repeated question and boundary messages", () => {
    const question = field("text", {
      label: "",
      minLength: 5,
      maxLength: 2,
      minInclusive: 10,
      maxInclusive: 1,
    });
    const issues = designerIssues({
      ...newForm(shape),
      fields: [question, { ...question, key: "other" }],
    });
    expect(issues).toEqual([
      "Give every question a title.",
      "Question: check the minimum and maximum.",
    ]);
  });
  it("creates all question kinds with appropriate datatype and a unique path", () => {
    for (const kind of [
      "text",
      "multiline",
      "decimal",
      "integer",
      "boolean",
      "date",
      "dateTime",
      "iri",
      "choice",
    ] as const) {
      const question = newQuestion("a", kind);
      expect(question.path).toBe("https://jeswr.org/ns/forms/answer/a");
      expect(question.kind).toBe(kind);
      expect(question.datatype === undefined).toBe(kind === "iri");
    }
  });
  it("reorders and duplicates without mutating the source", () => {
    const form = { ...newForm(shape), fields: [field("text"), newQuestion("b", "choice")] };
    const moved = moveQuestion(form, 0, 1);
    expect(moved.fields.map((item) => item.key)).toEqual(["q_b", "q_answer"]);
    expect(moved.fields.map((item) => item.order)).toEqual([0, 1]);
    expect(form.fields[0]?.key).toBe("q_answer");
    for (const [from, to] of [
      [-1, 0],
      [0, -1],
      [2, 0],
      [0, 2],
      [0, 0],
    ])
      expect(moveQuestion(form, from ?? 0, to ?? 0)).toBe(form);
    const duplicate = duplicateQuestion(form, "q_b", "c");
    expect(duplicate.fields.map((item) => item.key)).toEqual(["q_answer", "q_b", "q_c"]);
    expect(duplicate.fields[2]?.label).toMatch(/copy/);
    expect(duplicate.fields[2]?.options).not.toBe(form.fields[1]?.options);
    expect(duplicateQuestion(form, "missing", "c")).toBe(form);
    const unnamed = field("text");
    delete unnamed.label;
    expect(duplicateQuestion(model(unnamed), unnamed.key, "d").fields[1]?.label).toBe(
      "q_answer (copy)",
    );
  });
  it("validates form metadata, choices, lengths and ranges before saving", () => {
    expect(designerIssues(newForm(shape))).toEqual(["Add at least one question."]);
    expect(designerIssues({ ...model(field("text")), label: " " })).toContain(
      "Give your form a title.",
    );
    expect(designerIssues(model(field("text", { label: "" })))).toContain(
      "Give every question a title.",
    );
    for (const options of [
      [],
      [{ value: "", termType: "Literal" as const }],
      [
        { value: "A", termType: "Literal" as const },
        { value: "A", termType: "Literal" as const },
      ],
    ])
      expect(designerIssues(model(field("choice", { options })))).toHaveLength(1);
    const choice = field("choice");
    delete choice.options;
    expect(designerIssues(model(choice))).toHaveLength(1);
    for (const extra of [
      { minLength: -1 },
      { maxLength: 1.5 },
      { minLength: 4, maxLength: 2 },
      { minInclusive: 4, maxInclusive: 2 },
      { minInclusive: Number.NaN },
      { maxInclusive: Number.POSITIVE_INFINITY },
    ])
      expect(designerIssues(model(field("text", extra))).length).toBeGreaterThan(0);
    expect(designerIssues(model(field("choice")))).toEqual([]);
    expect(fillLink("https://suite.example", `${shape}?x=a&b=c`)).toBe(
      `https://suite.example/forms/f?form=${encodeURIComponent(`${shape}?x=a&b=c`)}`,
    );
  });
});

describe("CSV export", () => {
  it("formats values including false, zero, multiple values, nested values and dates", () => {
    expect(answerText(undefined)).toBe("");
    expect(answerText(false)).toBe("No");
    expect(answerText(true)).toBe("Yes");
    expect(answerText(0)).toBe("0");
    expect(answerText(["a", "b"])).toBe("a; b");
    expect(answerText({ nested: "value" })).toBe('{"nested":"value"}');
    expect(answerText(new Date("2026-11-11T10:00:00Z"))).toBe("2026-11-11T10:00:00.000Z");
  });
  it("quotes RFC 4180 cells and prevents formula injection in headers and values", () => {
    const question = field("text", { label: "=Header" });
    const form = model(question);
    const rows = [
      "=SUM(A1)",
      "+1",
      "-1",
      "@A1",
      "|1",
      "＝1",
      "＋1",
      "－1",
      "＠A1",
      "\t=1",
      'hello, "friend"\r\nnext',
      "",
    ].map((value, index) => ({
      subject: `https://pod.example/${index}`,
      form: shape,
      values: { q_answer: value },
    }));
    const csv = responsesCsv(form, rows);
    expect(csv).toContain('"Response URL","\'=Header"\r\n');
    for (const value of ["=SUM(A1)", "+1", "-1", "@A1", "\t=1"])
      expect(csv).toContain(`"'${value}"`);
    expect(csv).toContain('"hello, ""friend""\r\nnext"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(
      responsesCsv(
        { ...form, fields: [{ ...question, label: undefined } as unknown as FieldDescriptor] },
        [],
      ),
    ).toContain('"q_answer"');
  });
});
