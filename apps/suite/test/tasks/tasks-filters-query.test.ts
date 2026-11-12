// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it } from "vitest";
import {
  type FilterQuery,
  filterTasks,
  parseFilterQuery,
  savedFilters,
  serializeFilterQuery,
} from "../../src/apps/tasks/lib/views/filter-query";
import { webId } from "./pod";
import { view } from "./tasks-views-fixtures";

const now = new Date("2026-10-25T12:00:00Z");
const home = "https://pod.test/home.ttl";
const work = "https://pod.test/work.ttl";
const projects = [
  {
    url: home,
    title: "Home",
    labels: [
      { id: `${home}#rent`, name: "Bills" },
      { id: `${home}#errands`, name: "Errands" },
    ],
  },
  { url: work, title: "Work", labels: [{ id: `${work}#bills`, name: "bILLS" }] },
];
const tasks = [
  view("Rent", {
    projectUrl: home,
    priority: 1,
    labelIds: [`${home}#rent`],
    assignee: webId,
    allDay: "2026-10-25",
    description: "Pay landlord",
  }),
  view("Expenses", {
    projectUrl: work,
    priority: 2,
    labelIds: [`${work}#bills`],
    assignee: webId,
    allDay: "2026-10-24",
  }),
  view("Shop", {
    projectUrl: home,
    priority: 4,
    labelIds: [`${home}#errands`],
    allDay: "2026-10-31",
  }),
  view("Later", { projectUrl: home, priority: 3, allDay: "2026-11-01" }),
  view("Closed", { projectUrl: home, state: "closed", labelIds: [`${home}#rent`] }),
  view("Undated", { projectUrl: work }),
];
const match = (query: Omit<FilterQuery, "v"> = {}) =>
  filterTasks(tasks, { v: 1, ...query }, projects, now, webId).map((task) => task.title);

describe("versioned filter queries", () => {
  it("round-trips every field and the minimal query without coercion", () => {
    const query: FilterQuery = {
      v: 1,
      projects: [home, work],
      labels: ["BILLS", "Errands"],
      priorities: [1, 2, 3, 4],
      due: "next7",
      assignedToMe: true,
      text: "pay",
      includeCompleted: false,
    };
    expect(parseFilterQuery(serializeFilterQuery(query))).toEqual(query);
    expect(parseFilterQuery('{"v":1}')).toEqual({ v: 1 });
    expect(
      parseFilterQuery(
        '{"v":1,"projects":[],"labels":[],"priorities":[],"assignedToMe":false,"includeCompleted":true,"text":""}',
      ),
    ).toBeTruthy();
  });
  it.each([
    "broken",
    "null",
    "false",
    "0",
    '"query"',
    "[]",
    "{}",
    '{"v":2}',
    '{"v":"1"}',
    '{"v":1,"other":true}',
    '{"v":1,"__proto__":{}}',
    ...["projects", "labels", "priorities"].flatMap((field) =>
      [null, {}, "x", [null], [true]].map((value) => JSON.stringify({ v: 1, [field]: value })),
    ),
    '{"v":1,"projects":[""]}',
    '{"v":1,"labels":[" "]}',
    '{"v":1,"labels":[1]}',
    '{"v":1,"projects":["javascript:alert(1)"]}',
    '{"v":1,"projects":["https://a:b@pod.test/"]}',
    '{"v":1,"priorities":[0]}',
    '{"v":1,"priorities":[5]}',
    '{"v":1,"priorities":["1"]}',
    ...["due", "text", "assignedToMe", "includeCompleted"].map((field) =>
      JSON.stringify({ v: 1, [field]: 1 }),
    ),
    '{"v":1,"due":"tomorrow"}',
    '{"v":1,"due":null}',
  ])("skips malformed stored payload %s", (payload) =>
    expect(parseFilterQuery(payload)).toBeUndefined());
  it("rejects invalid writes and skips invalid saved views independently", () => {
    expect(() => serializeFilterQuery({ v: 2 } as unknown as FilterQuery)).toThrow(
      "Invalid filter query",
    );
    expect(
      savedFilters([
        { iri: "#view-broken", name: "Broken", payload: "{}" },
        { iri: "#view-ok", name: "OK", payload: '{"v":1}' },
      ]),
    ).toEqual([{ iri: "#view-ok", name: "OK", query: { v: 1 } }]);
  });
});

describe("saved query matching", () => {
  it("defaults to open tasks and treats empty lists as unrestricted", () => {
    expect(match()).toEqual(["Rent", "Expenses", "Shop", "Later", "Undated"]);
    expect(
      match({
        projects: [],
        priorities: [],
        labels: [],
        text: "",
        assignedToMe: false,
        due: "any",
      }),
    ).toEqual(match());
    expect(match({ includeCompleted: true })).toContain("Closed");
  });
  it("uses AND across fields, OR within projects, priorities and case-insensitive union labels", () => {
    expect(
      match({ projects: [home, work], labels: ["BILLS", "errands"], priorities: [1, 2, 4] }),
    ).toEqual(["Rent", "Expenses", "Shop"]);
    expect(
      match({
        projects: [home],
        labels: ["bills"],
        priorities: [1, 2],
        due: "today",
        assignedToMe: true,
        text: "LANDLORD",
      }),
    ).toEqual(["Rent"]);
    expect(match({ text: "eXpEnSeS" })).toEqual(["Expenses"]);
    expect(match({ text: "absent" })).toEqual([]);
    expect(match({ labels: ["unknown"] })).toEqual([]);
    expect(match({ labels: ["bills"], includeCompleted: true })).toEqual([
      "Rent",
      "Expenses",
      "Closed",
    ]);
    expect(match({ assignedToMe: true })).toEqual(["Rent", "Expenses"]);
    expect(
      filterTasks(
        [view("Forged", { projectUrl: work, labelIds: [`${home}#rent`] })],
        { v: 1, labels: ["bills"] },
        projects,
        now,
        webId,
      ),
    ).toEqual([]);
  });
  it("buckets overdue, today, next7 and no due date at calendar boundaries", () => {
    expect(match({ due: "overdue" })).toEqual(["Expenses"]);
    expect(match({ due: "today" })).toEqual(["Rent"]);
    expect(match({ due: "next7" })).toEqual(["Rent", "Shop"]);
    expect(match({ due: "none" })).toEqual(["Undated"]);
  });
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });
  it.each([
    "Europe/London",
    "America/Los_Angeles",
    "Pacific/Auckland",
  ])("uses browser-local timed days and preserves all-day markers in %s across DST", (zone) => {
    process.env.TZ = zone;
    const today = new Date(2026, 9, 25, 12);
    const timed = view("Timed", { due: new Date(2026, 9, 25, 0) });
    const late = view("Late", { due: new Date(2026, 9, 24, 23, 59) });
    const marker = view("All-day", { allDay: "2026-10-25", due: new Date("2026-10-24T10:00:00Z") });
    const end = view("Boundary", { due: new Date(2026, 10, 1, 0) });
    expect(
      filterTasks([late, timed, marker, end], { v: 1, due: "today" }, [], today, webId),
    ).toEqual([timed, marker]);
    expect(
      filterTasks([late, timed, marker, end], { v: 1, due: "next7" }, [], today, webId),
    ).toEqual([timed, marker]);
  });
});
