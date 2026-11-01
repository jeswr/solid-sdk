// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { NS, node } from "../../src/apps/tasks/lib/model/rdf";
import { priorityValue, toTaskView } from "../../src/apps/tasks/lib/views/types";
import { now, webId } from "./pod";
import { project, storedTask } from "./tasks-views-fixtures";

describe("shared TaskView projection from real model objects", () => {
  it("projects every task field and filters types through its tracker's dimensions", () => {
    const home = project();
    const section = home.tracker.defineCategory("Section", "Doing");
    const label = home.tracker.defineCategory("Label", "Bills");
    home.tracker.defineCategory("Label", "Unused");
    const due = new Date(2026, 9, 25);
    const stored = storedTask("Pay rent", {
      description: "Transfer before the first",
      state: "closed",
      dueDate: due,
      allDay: "2026-10-25",
      priority: "high",
      rank: 2,
      categoryTypes: [section.id, label.id, "https://foreign.test/type"],
      parent: "https://pod.test/parent#it",
      assignee: webId,
      recurrence: { frequency: "MONTHLY", byMonthDay: 25 },
      reminders: [{ offset: "-PT1H" }],
      created: now,
      endedAt: now,
      clonedFrom: "https://pod.test/repeating#it",
    });
    expect(toTaskView(stored, home)).toEqual({
      url: stored.url,
      id: stored.task.id,
      projectUrl: home.url,
      projectTitle: "Home",
      title: "Pay rent",
      description: "Transfer before the first",
      state: "closed",
      due,
      allDay: "2026-10-25",
      priority: 1,
      position: 2,
      sectionId: section.id,
      labelIds: [label.id],
      parentId: "https://pod.test/parent#it",
      assignee: webId,
      recurring: true,
      hasReminders: true,
      created: now,
      completedAt: now,
      derivedFrom: "https://pod.test/repeating#it",
    });
  });

  it.each([
    [1, "high"],
    [2, "medium"],
    [3, "low"],
    [4, undefined],
  ] as const)("round-trips P%s through RDF", (level, priority) => {
    expect(priorityValue(level)).toBe(priority);
    expect(toTaskView(storedTask("Priority", { priority }), project()).priority).toBe(level);
  });

  it("supports absent metadata in cross-app RDF and defaults unrecognised priority to P4", () => {
    const home = project();
    const stored = storedTask("Minimal");
    node(stored.task.id, stored.dataset).clear(`${NS.DCT}title`);
    node(home.tracker.id, home.dataset).clear(`${NS.DCT}title`);
    const result = toTaskView(stored, home);
    expect(result).toMatchObject({
      title: "",
      projectTitle: "",
      state: "open",
      priority: 4,
      labelIds: [],
      recurring: false,
      hasReminders: false,
    });
    expect(result.sectionId).toBeUndefined();
    expect(result.due).toBeUndefined();
  });
});
