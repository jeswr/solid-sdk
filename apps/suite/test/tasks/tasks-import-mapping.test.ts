// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  importProjectDescription,
  importTaskInput,
  importWarnings,
} from "../../src/apps/tasks/lib/import/mapping";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import { parseTodoistCsv } from "../../src/apps/tasks/lib/todoist";

describe("Todoist task create inputs", () => {
  const url = "https://pod.test/tasks/project.ttl";
  const project = { url, etag: null, ...createTracker(url, "Work", `${url}/`, [], new Date()) };
  const label = project.tracker.defineCategory("Label", "Work");
  const section = project.tracker.defineCategory("Section", "Doing");
  const parse = (csv: string) => parseTodoistCsv(csv, { defaultTimeZone: "Europe/London" });
  it("maps sections, labels, notes and all-day dates without interpreting file content", () => {
    const draft = parse(
      "TYPE,CONTENT,DESCRIPTION,PRIORITY,DATE\nsection,Doing,,,\ntask,<b>Title</b> @work @WORK,Description,2,2026-07-01\nnote,Note,More,,",
    );
    const task = draft.tasks[0];
    if (!task) throw new Error("Missing draft");
    expect(importTaskInput(task, project, new Map([["section-0", section.id]]))).toEqual({
      title: "<b>Title</b>",
      description: "Description\n\nNote\n\nMore",
      priority: "medium",
      due: new Date("2026-06-30T23:00:00Z"),
      allDay: "2026-07-01",
      position: 1,
      sectionId: section.id,
      labelIds: [label.id],
    });
  });
  it.each([1, 2, 3, 4])("maps priority %i and timed dates", (priority) => {
    const task = parse(`TYPE,CONTENT,PRIORITY,DATE\ntask,Title,${priority},2026-07-01T15:00:00Z`)
      .tasks[0];
    if (!task) throw new Error("Missing draft");
    expect(importTaskInput(task, project, new Map())).toMatchObject({
      priority: ["high", "medium", "low", undefined][priority - 1],
      due: new Date("2026-07-01T15:00:00Z"),
      allDay: undefined,
      sectionId: undefined,
      description: "",
    });
  });
  it("retains unsupported recurrence text and leaves undated tasks undated", () => {
    for (const date of ["", "every third Friday"]) {
      const task = parse(`TYPE,CONTENT,DATE\ntask,Title,${date}`).tasks[0];
      if (!task) throw new Error("Missing draft");
      expect(importTaskInput(task, project, new Map())).toMatchObject({
        due: undefined,
        allDay: undefined,
        description: date ? `Original date: ${date}` : "",
      });
      expect(importTaskInput(task, project, new Map())).not.toHaveProperty("recurrence");
    }
  });
  it("keeps unresolved identities, note authors, duration and date language as labelled text", () => {
    const draft = parse(
      "TYPE,CONTENT,DESCRIPTION,AUTHOR,RESPONSIBLE,DURATION,DURATION_UNIT,DATE_LANG\nsection,Doing,Section details,,,,,\ntask,Title,Body,Alice,Bob,45,minute,en\nnote,Comment,More,Carol,,,,",
    );
    const task = draft.tasks[0];
    if (!task) throw new Error("Missing draft");
    expect(importTaskInput(task, project, new Map()).description).toBe(
      "Body\n\nAuthor: Alice\n\nResponsible: Bob\n\nDuration: 45 minutes\n\nDate language: en\n\nComment\n\nMore\n\nNote author: Carol",
    );
    expect(importProjectDescription(draft)).toBe('Section "Doing" description: Section details');
    expect(importWarnings(draft)).toEqual([
      { code: "SECTION_DESCRIPTION", line: 2 },
      { code: "UNRESOLVED_AUTHOR", line: 3 },
      { code: "UNRESOLVED_RESPONSIBLE", line: 3 },
      { code: "DURATION_TEXT", line: 3 },
      { code: "DATE_LANGUAGE_TEXT", line: 3 },
      { code: "NOTE_AUTHOR_TEXT", line: 4 },
    ]);
  });
  it.each([
    ["1", "day", "1 day"],
    ["1.5", "day", "1.5 days"],
  ])("maps WebID identities and retains a %s %s duration", (amount, unit, text) => {
    const draft = parse(
      `TYPE,CONTENT,AUTHOR,RESPONSIBLE,DURATION,DURATION_UNIT\ntask,Title,https://alice.test/#me,https://bob.test/#me,${amount},${unit}`,
    );
    const task = draft.tasks[0];
    if (!task) throw new Error("Missing draft");
    expect(importTaskInput(task, project, new Map())).toMatchObject({
      creator: "https://alice.test/#me",
      assignee: "https://bob.test/#me",
      description: `Duration: ${text}`,
    });
    expect(importWarnings(draft)).toEqual([{ code: "DURATION_TEXT", line: 2 }]);
    expect(importProjectDescription(draft)).toBe("");
  });
  it("combines parser warnings with metadata warnings without adding warnings for empty fields", () => {
    const draft = parse(
      "TYPE,CONTENT,DATE\nsection,Empty,\ntask,Title,every third Friday\nnote,Note,",
    );
    expect(importWarnings(draft)).toEqual(draft.warnings);
    expect(importProjectDescription(draft)).toBe("");
  });
  it("requires a tracker-local label before task creation", () => {
    const task = parse("TYPE,CONTENT\ntask,Title @missing").tasks[0];
    if (!task) throw new Error("Missing draft");
    expect(() => importTaskInput(task, project, new Map())).toThrow("label has not been saved");
  });
});
