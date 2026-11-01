// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { labelSlug, labelUnion, labelViewGroups } from "../../src/apps/tasks/lib/views/labels";
import { project, view } from "./tasks-views-fixtures";

describe("tracker-local labels unioned by name", () => {
  const home = project();
  const inbox = project("Inbox");
  const empty = project("Empty");
  const bills = home.tracker.defineCategory("Label", "Bills");
  const alternate = home.tracker.defineCategory("Label", "bills");
  const inboxBills = inbox.tracker.defineCategory("Label", "BILLS");
  const zoo = home.tracker.defineCategory("Label", "Zoo");
  const emptyLabel = empty.tracker.defineCategory("Label", "Unused");
  const projects = [home, inbox, empty].map((p) => ({
    url: p.url,
    title: p.tracker.title as string,
    labels: p.tracker.labels,
  }));
  const h1 = view("h1", { labelIds: [bills.id, alternate.id], position: 2 });
  const h2 = view("h2", { labelIds: [alternate.id], position: 1 });
  const h3 = view("h3", { labelIds: [bills.id] });
  const i1 = view("i1", { projectUrl: inbox.url, labelIds: [inboxBills.id] });
  const tasks = [
    h1,
    h3,
    h2,
    i1,
    view("closed", { labelIds: [bills.id], state: "closed" }),
    view("unlabelled"),
    view("foreign", { projectUrl: "https://foreign.test/project", labelIds: [bills.id] }),
    view("wrong project", { labelIds: [inboxBills.id] }),
  ];

  it("retains local identities, counts each open task once, and sorts including unused labels", () => {
    expect(labelUnion(projects, tasks)).toEqual([
      {
        key: "bills",
        name: "Bills",
        count: 4,
        members: [
          { projectUrl: home.url, labelId: bills.id },
          { projectUrl: home.url, labelId: alternate.id },
          { projectUrl: inbox.url, labelId: inboxBills.id },
        ],
      },
      {
        key: "unused",
        name: "Unused",
        count: 0,
        members: [{ projectUrl: empty.url, labelId: emptyLabel.id }],
      },
      { key: "zoo", name: "Zoo", count: 0, members: [{ projectUrl: home.url, labelId: zoo.id }] },
    ]);
    expect(labelUnion([], tasks)).toEqual([]);
  });

  it("groups open rows by owning project in sidebar order with manual order within each", () => {
    expect(labelViewGroups("BILLS", tasks, projects)).toEqual([
      { projectUrl: home.url, projectTitle: "Home", tasks: [h2, h1, h3] },
      { projectUrl: inbox.url, projectTitle: "Inbox", tasks: [i1] },
    ]);
    expect(labelViewGroups("missing", tasks, projects)).toEqual([]);
    expect(labelViewGroups("unused", tasks, projects)).toEqual([]);
    expect(labelViewGroups("bills", [], projects)).toEqual([]);
    const noPosition = view("missing position", { labelIds: [bills.id] });
    expect(labelViewGroups("bills", [noPosition, h1, h2], projects)[0]?.tasks).toEqual([
      h2,
      h1,
      noPosition,
    ]);
  });

  it("matches defineCategory's normalisation, collision suffixes and existing-name edits", () => {
    const p = project("Slug");
    const used: string[] = [];
    for (const name of ["A+B", "A B", "A-B", "Crème brûlée", "👋", "x".repeat(60)]) {
      const slug = labelSlug(name, used);
      const label = p.tracker.defineCategory("Label", name);
      expect(label.id).toBe(`${p.url}#label-${slug}`);
      used.push(slug);
    }
    expect(labelSlug(" A+B ")).toBe("a-b");
    expect(labelSlug("A/B", new Set(["a-b", "a-b-2", "a-b-3"]))).toBe("a-b-4");
    expect(p.tracker.defineCategory("Label", "A B").id).toBe(`${p.url}#label-a-b-2`);
    expect(() => labelSlug(" ")).toThrow(TypeError);
  });
});
