// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { parseTaskImport } from "../../src/apps/tasks/lib/import/file";

const csv = "TYPE,CONTENT,DATE\ntask,Local,2026-07-01T15:30:00";
const json = '{"kind":"tasks#taskLists","items":[]}';
const parse = (text: string, name = "", type = "") =>
  parseTaskImport(text, { name, type, timeZone: "Europe/London" });

describe("task import format detection", () => {
  it.each([
    ["Tasks.JSON", "application/json", json],
    ["export", "APPLICATION/JSON; charset=utf-8", json],
    ["wrong.csv", "text/csv", `\uFEFF  ${json}`],
    ["unknown", "", json],
  ])("recognises Google JSON from metadata or content: %s", (name, type, text) => {
    expect(parse(text, name, type)).toEqual({ kind: "google", projects: [] });
  });
  it.each([
    ["Work.CSV", "text/csv"],
    ["Work", "text/csv"],
    ["wrong.json", "application/json"],
    ["unknown", ""],
  ])("recognises CSV and preserves the browser time zone: %s", (name, type) => {
    const result = parse(csv, name, type);
    expect(result.kind).toBe("todoist");
    expect(result.projects[0]?.name).toBe(name.replace(/\.csv$/i, ""));
    expect(result.projects[0]?.tasks[0]?.due?.dateTime).toBe("2026-07-01T14:30:00.000Z");
  });
  it.each([
    ["Tasks.json", ""],
    ["export", "application/json"],
    ["unknown", ""],
  ])("reports malformed JSON safely: %s", (name, type) => {
    expect(() => parse('{"SECRET":', name, type)).toThrow("INVALID_JSON");
  });
  it("uses JSON metadata for an invalid non-object document", () => {
    expect(() => parse("null", "Tasks.json")).toThrow("INVALID_DATA");
    expect(() => parse("null", "export", "application/json")).toThrow("INVALID_DATA");
    expect(() => parse("[]")).toThrow("INVALID_DATA");
  });
  it("uses CSV metadata for invalid CSV and rejects unsupported input", () => {
    expect(() => parse("invalid", "Work.csv")).toThrow("INVALID_CSV");
    expect(() => parse("invalid", "export", "text/csv")).toThrow("INVALID_CSV");
    expect(() => parse("invalid", "notes.txt", "text/plain")).toThrow(
      "Unsupported task import file",
    );
  });
});
