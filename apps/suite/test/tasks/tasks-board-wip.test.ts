// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { dropMessage, projectNames } from "../../src/apps/tasks/lib/dnd/announce";
import { planDrop } from "../../src/apps/tasks/lib/dnd/plan";
import { DataFactory, NS, node, parse, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { applyDropPlan } from "../../src/apps/tasks/state/drop-actions";
import {
  defaultPreferences,
  parsePreferences,
  preferencesReducer,
} from "../../src/apps/tasks/state/preferences-reducer";
import { frameCache } from "./tasks-frame-fixtures";
import { project, view } from "./tasks-views-fixtures";

vi.mock("@jeswr/suite-ui", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("section WIP limits", () => {
  it("writes the existing suite predicate as an integer on the section class with If-Match and removes it conditionally", async () => {
    const { cache, pod, store, inbox } = await frameCache();
    await cache.addSection(inbox, "Doing");
    const current = cache.getSnapshot().projects[0];
    const id = current?.tracker.sections[0]?.id;
    if (!current || !id) throw new Error("Missing section");
    pod.requests.length = 0;
    const changed = await cache.updateProject(current, (tracker) =>
      tracker.setSectionWipLimit(id, 5),
    );
    expect(changed?.tracker.sections[0]?.wipLimit).toBe(5);
    expect(pod.mutations()).toHaveLength(1);
    expect(pod.mutations()[0]?.headers.get("If-Match")).toBe(current.etag);
    const dataset = await parse(current.url, pod.mutations()[0]?.body ?? "");
    const triple = [
      ...dataset.match(DataFactory.namedNode(id), DataFactory.namedNode(`${NS.TASK}wipMax`)),
    ][0];
    expect(triple?.object).toMatchObject({
      value: "5",
      datatype: { value: `${NS.XSD}nonNegativeInteger` },
    });
    expect(node(current.tracker.id, dataset).number(`${NS.TASK}wipMax`)).toBeUndefined();
    if (!changed) throw new Error("Missing changed project");
    await cache.updateProject(changed, (tracker) => tracker.setSectionWipLimit(id, undefined));
    expect(pod.mutations()[1]?.headers.get("If-Match")).toBe(changed.etag);
    expect((await store.readProject(current.url)).tracker.sections[0]?.wipLimit).toBeUndefined();
  });
  it("validates optional positive integers and retains foreign section RDF, reading legacy limits", async () => {
    const { tracker, dataset } = project();
    const section = tracker.defineCategory("Section", "Doing");
    const label = tracker.defineCategory("Label", "Red");
    for (const invalid of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => tracker.setSectionWipLimit(section.id, invalid)).toThrow("positive integer");
    expect(() => tracker.setSectionWipLimit(label.id, 1)).toThrow("Unknown section");
    const item = node(section.id, dataset);
    item.setText("https://example.test/foreign", "keep");
    item.setNumber("https://w3id.org/jeswr/task#wipMax", 3, true);
    expect(tracker.sections[0]?.wipLimit).toBe(3);
    tracker.setSectionWipLimit(section.id, 4);
    expect(item.number("https://w3id.org/jeswr/task#wipMax")).toBeUndefined();
    expect(item.text("https://example.test/foreign")).toBe("keep");
    expect(await serialize(dataset)).toContain("wipMax");
    item.setNumber(`${NS.TASK}wipMax`, -1);
    expect(tracker.sections[0]?.wipLimit).toBeUndefined();
    item.setText(`${NS.TASK}wipMax`, "invalid");
    expect(tracker.sections[0]?.wipLimit).toBeUndefined();
  });
  it("allows a move into a full column and announces the warning using the whole open section count", async () => {
    const { cache, inbox, store, pod } = await frameCache();
    await cache.addSection(inbox, "Doing");
    const current = cache.getSnapshot().projects[0];
    const id = current?.tracker.sections[0]?.id;
    if (!current || !id) throw new Error("Missing section");
    await cache.updateProject(current, (tracker) => tracker.setSectionWipLimit(id, 1));
    await cache.createTask(current, { title: "Existing", sectionId: id, priority: "medium" });
    const moved = await cache.createTask(current, { title: "Moving" });
    if (!moved) throw new Error("Missing task");
    const snapshot = cache.getSnapshot();
    const active = snapshot.views.find((task) => task.url === moved.url);
    if (!active) throw new Error("Missing view");
    const plan = planDrop(
      active,
      {
        kind: "section",
        projectUrl: inbox.url,
        sectionId: id,
        at: "end",
        lane: { group: "priority", value: "1" },
      },
      snapshot.views,
      { flat: true },
    );
    expect(
      dropMessage(active, plan, snapshot.views, projectNames(snapshot.projects), true, true),
    ).toContain("Over WIP limit");
    pod.requests.length = 0;
    expect(
      await applyDropPlan(plan, {
        cache,
        updateTask: cache.updateTask.bind(cache),
        moveTaskToProject: cache.moveTaskToProject.bind(cache),
      }),
    ).toBe(true);
    const saved = await store.readTask(moved.url);
    expect(saved.task.types.has(id)).toBe(true);
    expect(saved.task.priority).toBe("high");
    expect(pod.mutations()).toHaveLength(1);
    expect(pod.mutations()[0]?.headers.get("If-Match")).toBe(moved.etag);
  });
  it("writes and clears assignments and priority in cross-lane drops without changing labels", async () => {
    const { cache, inbox, store } = await frameCache();
    const item = await cache.createTask(inbox, { title: "Task" });
    if (!item) throw new Error("Missing task");
    const writer = {
      cache,
      updateTask: cache.updateTask.bind(cache),
      moveTaskToProject: cache.moveTaskToProject.bind(cache),
    };
    for (const lane of [
      { group: "assignee", value: "https://bob.test/#me" },
      { group: "assignee", value: "" },
      { group: "priority", value: "2" },
      { group: "priority", value: "4" },
    ] as const) {
      const views = cache.getSnapshot().views;
      const active = views[0];
      if (!active) throw new Error("Missing view");
      await applyDropPlan(
        planDrop(active, { kind: "section", projectUrl: inbox.url, at: "end", lane }, views, {
          flat: true,
        }),
        writer,
      );
      const saved = (await store.readTask(item.url)).task;
      if (lane.group === "assignee") expect(saved.assignee).toBe(lane.value || undefined);
      else expect(saved.priority).toBe(lane.value === "2" ? "medium" : undefined);
    }
  });
});

it("rolls back both lane and section changes after a failed conditional task write", async () => {
  const { cache, inbox, pod, store, failures } = await frameCache();
  await cache.addSection(inbox, "Doing");
  const current = cache.getSnapshot().projects[0];
  const section = current?.tracker.sections[0];
  if (!current || !section) throw new Error("Missing section");
  const item = await cache.createTask(current, { title: "Task" });
  if (!item) throw new Error("Missing task");
  const active = cache.getSnapshot().views[0];
  if (!active) throw new Error("Missing view");
  const plan = planDrop(
    active,
    {
      kind: "section",
      projectUrl: inbox.url,
      sectionId: section.id,
      at: "end",
      lane: { group: "priority", value: "1" },
    },
    cache.getSnapshot().views,
    { flat: true },
  );
  pod.intercept = (request) =>
    request.method === "PUT" && request.url === item.url
      ? new Response(null, { status: 412 })
      : undefined;
  const writer = {
    cache,
    updateTask: cache.updateTask.bind(cache),
    moveTaskToProject: cache.moveTaskToProject.bind(cache),
  };
  expect(await applyDropPlan(plan, writer)).toBe(false);
  expect(failures).toHaveBeenCalled();
  expect(cache.getSnapshot().views[0]).toMatchObject({ priority: 4, sectionId: undefined });
  expect((await store.readTask(item.url)).task.priority).toBeUndefined();
  expect((await store.readTask(item.url)).task.types.has(section.id)).toBe(false);
});

it("persists and validates independent project grouping preferences", () => {
  const one = preferencesReducer(defaultPreferences, {
    type: "boardGrouping",
    viewId: "one",
    value: "priority",
  });
  const two = preferencesReducer(one, { type: "boardGrouping", viewId: "two", value: "assignee" });
  expect(parsePreferences(JSON.stringify(two)).boardGrouping).toEqual({
    one: "priority",
    two: "assignee",
  });
  expect(
    parsePreferences('{"boardGrouping":{"bad":"due","good":"label","off":"none"}}').boardGrouping,
  ).toEqual({ good: "label", off: "none" });
  expect(defaultPreferences.boardGrouping).toEqual({});
  expect(dropMessage(view("task"), { kind: "none" }, [], [])).toContain("original place");
});
