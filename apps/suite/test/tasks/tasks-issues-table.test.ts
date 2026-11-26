// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type IssueFilters,
  type IssueRow,
  issueColumns,
  issueRow,
  issueTable,
} from "../../src/apps/tasks/lib/issues/table";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import { webId } from "./pod";
import { issuesFixture } from "./tasks-issues-fixtures";

const filters: IssueFilters = { state: "open", assignee: "anyone", label: "", text: "" };
const view: TaskView = {
  url: "https://pod.test/a",
  id: "https://pod.test/a#it",
  projectUrl: "https://pod.test/tracker.ttl",
  projectTitle: "Support",
  title: "Alpha",
  state: "open",
  priority: 1,
  labelIds: ["bug"],
  recurring: false,
  hasReminders: false,
};
const rows: IssueRow[] = [
  {
    view: {
      ...view,
      created: new Date("2026-01-01Z"),
      assignee: webId,
      description: "Crash report",
    },
    updated: new Date("2026-01-02Z"),
    labels: "Bug",
  },
  {
    view: {
      ...view,
      url: "https://pod.test/b",
      title: "Beta",
      state: "closed",
      priority: 3,
      assignee: "https://bob.test/#me",
      labelIds: ["docs"],
      created: new Date("2026-01-03Z"),
    },
    labels: "Docs",
  },
  {
    view: { ...view, url: "https://pod.test/c", title: "Gamma", priority: 4, labelIds: [] },
    labels: "",
  },
];
describe("Issues table", () => {
  it("defaults to Open and filters by text, assignee and label together", () => {
    expect(issueTable(rows, filters, webId, "title").map((row) => row.view.title)).toEqual([
      "Alpha",
      "Gamma",
    ]);
    expect(
      issueTable(
        rows,
        { ...filters, text: "  CRASH ", assignee: "me", label: "bug" },
        webId,
        "title",
      ).map((row) => row.view.title),
    ).toEqual(["Alpha"]);
    expect(
      issueTable(rows, { ...filters, assignee: "unassigned" }, webId, "title").map(
        (row) => row.view.title,
      ),
    ).toEqual(["Gamma"]);
    expect(
      issueTable(rows, { ...filters, state: "closed", text: "docs" }, webId, "title").map(
        (row) => row.view.title,
      ),
    ).toEqual(["Beta"]);
    expect(issueTable(rows, { ...filters, label: "absent" }, webId, "title")).toEqual([]);
  });
  it.each(
    issueColumns,
  )("sorts %s both ways, with deterministic ties and missing values", (column) => {
    const all = { ...filters, state: "all" as const };
    const ascending = issueTable(rows, all, webId, column);
    const descending = issueTable(rows, all, webId, column, true);
    expect(descending.map((row) => row.view.url)).toEqual(
      (column === "state"
        ? [rows[0], rows[2], rows[1]]
        : column === "updated"
          ? rows
          : ascending.toReversed()
      ).map((row) => row?.view.url),
    );
    const same = [
      { ...(rows[0] as IssueRow), view: { ...view, url: "https://pod.test/z" } },
      { ...(rows[0] as IssueRow), view },
    ];
    expect(issueTable(same, all, webId, column)[0]?.view.url).toBe(view.url);
  });
  it("uses the shared TaskView projection and tracker label names", async () => {
    const { store, project } = await issuesFixture();
    const labelled = await store.updateProject(project, (tracker) =>
      tracker.defineCategory("Label", "Bug"),
    );
    const item = await store.createTask(
      labelled,
      { title: "A bug", state: "open", categoryTypes: [labelled.tracker.labels[0]?.id ?? ""] },
      "row",
    );
    expect(issueRow(item, labelled)).toMatchObject({
      view: { title: "A bug", state: "open" },
      labels: "Bug",
    });
  });
});
