// AUTHORED-BY Codex (GPT-6.1 Sol)
import type {
  FieldDescriptor,
  FormModel,
  FormRuntime,
  FormValues,
  ValidationResult,
} from "./runtime";

/** TEST/DEMO DOUBLE ONLY. JSON in, JSON out; no SHACL admission or RDF support. */
export type FakeGraph = { model: FormModel } | { subject: string; values: FormValues };

function validValue(field: FieldDescriptor, value: unknown): boolean {
  switch (field.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "decimal":
      return typeof value === "number" && Number.isFinite(value);
    case "iri": {
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    }
    case "date":
      return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value
      );
    case "dateTime":
      return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        Number.isFinite(Date.parse(value))
      );
    case "choice":
      return field.options?.some((option) => option.value === value) ?? false;
    case "node":
      return false; // Nested editing belongs to the real runtime's later integration.
    default:
      return typeof value === "string";
  }
}

export function createFakeRuntime(): FormRuntime<FakeGraph, FakeGraph> {
  const validate = (form: FormModel, values: FormValues): ValidationResult => {
    const issues: ValidationResult["issues"] = [];
    for (const field of form.fields) {
      const raw = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
      const entries = raw === undefined || raw === "" ? [] : Array.isArray(raw) ? raw : [raw];
      const issue = (message: string) =>
        issues.push({ key: field.key, path: field.path, message, severity: field.severity });
      if (entries.length < field.minCount) issue("This question needs an answer.");
      if (field.maxCount !== undefined && entries.length > field.maxCount)
        issue("There are too many answers.");
      for (const value of entries) {
        if (!validValue(field, value)) {
          issue("Enter a valid answer.");
          continue;
        }
        if (typeof value === "string") {
          if (field.minLength !== undefined && value.length < field.minLength)
            issue(`Use at least ${field.minLength} characters.`);
          if (field.maxLength !== undefined && value.length > field.maxLength)
            issue(`Use no more than ${field.maxLength} characters.`);
        }
        if (typeof value === "number") {
          if (field.minInclusive !== undefined && value < field.minInclusive)
            issue(`Enter ${field.minInclusive} or more.`);
          if (field.maxInclusive !== undefined && value > field.maxInclusive)
            issue(`Enter ${field.maxInclusive} or less.`);
        }
      }
    }
    return { valid: !issues.some((issue) => issue.severity === "violation"), issues };
  };
  return {
    validate,
    compileForm(graph, shape) {
      if (!("model" in graph) || graph.model.shape !== shape)
        throw new Error("Demo form not found");
      return structuredClone(graph.model);
    },
    formToShapes: (model) => ({ model: structuredClone(model) }),
    build(form, subject, values) {
      const url = new URL(subject);
      if (!["http:", "https:"].includes(url.protocol) || !validate(form, values).valid)
        throw new Error("Invalid response");
      return { subject, values: structuredClone(values) };
    },
    parse(form, subject, graph) {
      if (!("values" in graph) || graph.subject !== subject) return {};
      const values: FormValues = Object.create(null);
      for (const field of form.fields) {
        const value = graph.values[field.key];
        if (
          value !== undefined &&
          validate({ ...form, fields: [field] }, { [field.key]: value }).valid
        )
          values[field.key] = structuredClone(value);
      }
      return values;
    },
    serialize: async (graph) => JSON.stringify(graph),
  };
}
