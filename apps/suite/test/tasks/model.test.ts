// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Writer } from "n3";
import { describe, expect, it } from "vitest";
import {
  DataFactory,
  documentUrl,
  NS,
  node,
  parse,
  requireDate,
  requireHttp,
  requireTitle,
  SCHEMA,
  Store,
  serialize,
  slug,
  uniqueSlug,
} from "../../src/apps/tasks/lib/model/rdf";
import {
  computeFireTimes,
  offsetMilliseconds,
  pendingReminders,
  readReminders,
  shiftReminders,
  validateReminders,
  writeReminders,
} from "../../src/apps/tasks/lib/model/reminders";
import {
  createTask,
  planCompletion,
  positionBetween,
  subtaskProgress,
  type TaskDetails,
  TaskItem,
  taskDetails,
  validateTask,
} from "../../src/apps/tasks/lib/model/task";
import { createTracker, TaskTracker, unionLabels } from "../../src/apps/tasks/lib/model/tracker";
import { now, storage, webId } from "./pod";

const project = `${storage}tasks/projects/home.ttl`;
const taskUrl = `${storage}tasks/projects/home/rent.ttl`;
const fixture = `@prefix wf: <${NS.WF}>. @prefix dct: <${NS.DCT}>. @prefix rdfs: <${NS.RDFS}>. @prefix schema: <${SCHEMA}>. @prefix prov: <${NS.PROV}>. @prefix vcard: <${NS.VCARD}>. @prefix xsd: <${NS.XSD}>.
<#this> a wf:Tracker; dct:title "Home"; dct:description "House"; dct:created "2026-10-25T12:00:00Z"^^xsd:dateTime; dct:modified "2026-10-25T12:00:00Z"^^xsd:dateTime; wf:issueClass wf:Task; wf:stateStore <home/>; wf:issueCategory <#Section>, <#Label>; wf:assigneeGroup <#members>; schema:position 2.0.
<#Section> a rdfs:Class; rdfs:label "Section".
<#section-doing> a rdfs:Class; rdfs:subClassOf <#Section>; rdfs:label "Doing"; schema:position 2.0.
<#Label> a rdfs:Class; rdfs:label "Label".
<#label-bills> a rdfs:Class; rdfs:subClassOf <#Label>; rdfs:label "bills"; schema:color "amber".
<#members> a vcard:Group; vcard:hasMember <${webId}>.`;
const taskFixture = `@prefix wf: <${NS.WF}>. @prefix dct: <${NS.DCT}>. @prefix schema: <${SCHEMA}>. @prefix prov: <${NS.PROV}>. @prefix xsd: <${NS.XSD}>.
<#it> a wf:Task, wf:Open, <${project}#section-doing>, <${project}#label-bills>; dct:title "Pay rent"; wf:description "Transfer before the 1st"; dct:description "Transfer before the 1st"; dct:created "2026-10-25T12:00:00Z"^^xsd:dateTime; dct:modified "2026-10-25T12:00:00Z"^^xsd:dateTime; dct:creator <${webId}>; wf:tracker <${project}#this>; wf:dateDue "2026-11-01T09:00:00Z"^^xsd:dateTime; schema:priority "high"; schema:position 3.0; dct:isPartOf <${taskUrl}#parent>; wf:assignee <${storage}bob#me>.`;
/** No blank nodes in §5.2/§5.3: sorted N-Triples is a byte-equivalent graph comparison. */
async function canonical(dataset: Store): Promise<string> {
  const writer = new Writer({ format: "N-Triples" });
  writer.addQuads([...dataset].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}
const details: TaskDetails = {
  title: "Pay rent",
  state: "open",
  created: now,
  dueDate: new Date("2026-11-01T09:00:00Z"),
};

describe("RDF model interoperability", () => {
  it.each([
    "Label",
    "Section",
  ] as const)("preserves %s identities across colliding names", async (kind) => {
    const { tracker, dataset } = createTracker(project, "Home", storage, [], now);
    const original = tracker.defineCategory(kind, "A+B", 1, "amber");
    const task = new TaskItem(
      `${taskUrl}#it`,
      createTask(taskUrl, {
        ...details,
        categoryTypes: [original.id],
      }),
      DataFactory,
    );
    const second = tracker.defineCategory(kind, "A B", 2, "blue");
    const third = tracker.defineCategory(kind, "A-B", 3, "green");
    expect(second.id).toBe(`${original.id}-2`);
    expect(third.id).toBe(`${original.id}-3`);
    const restored = new TaskTracker(
      `${project}#this`,
      await parse(project, await serialize(dataset)),
      DataFactory,
    );
    const categories = kind === "Label" ? restored.labels : restored.sections;
    expect(categories).toEqual([original, second, third]);
    expect(task.types.has(original.id)).toBe(true);
    const updated = restored.defineCategory(kind, "A B", 4, "red");
    expect(updated.id).toBe(second.id);
    expect(kind === "Label" ? restored.labels : restored.sections).toHaveLength(3);
    // Also reserve IRIs occupied by foreign metadata, regardless of category type.
    node(`${original.id}-4`, restored.dataset).setText(`${NS.DCT}title`, "Foreign");
    expect(restored.defineCategory(kind, "A/B").id).toBe(`${original.id}-5`);
  });
  it("round-trips the complete §5.2 and §5.3 graphs byte-equivalently through n3", async () => {
    for (const [url, text] of [
      [project, fixture],
      [taskUrl, taskFixture],
    ] as const) {
      const dataset = await parse(url, text);
      const output = await parse(url, await serialize(dataset));
      expect(await canonical(output)).toBe(await canonical(dataset));
    }
    const data = await parse(project, fixture);
    const tracker = new TaskTracker(`${project}#this`, data, DataFactory);
    expect(tracker.title).toBe("Home");
    expect(tracker.description).toBe("House");
    expect(tracker.created).toEqual(now);
    expect(tracker.modified).toEqual(now);
    expect(tracker.position).toBe(2);
    expect(tracker.sections).toEqual([
      { id: `${project}#section-doing`, name: "Doing", position: 2, color: undefined },
    ]);
    expect(tracker.labels[0]?.color).toBe("amber");
    expect(tracker.groupMembers).toEqual([webId]);
    const task = taskDetails(taskUrl, await parse(taskUrl, taskFixture));
    expect(task).toMatchObject({
      title: "Pay rent",
      description: "Transfer before the 1st",
      priority: "high",
      rank: 3,
      parent: `${taskUrl}#parent`,
      assignee: `${storage}bob#me`,
      project: `${project}#this`,
    });
    expect(task?.categoryTypes).toHaveLength(2);
  });
  it("creates and edits project metadata, dimensions, ordering, labels and member groups", () => {
    const { dataset, tracker } = createTracker(
      project,
      "Home",
      `${storage}tasks/projects/home/`,
      [],
      now,
    );
    expect(tracker.categories.size).toBe(2);
    expect(tracker.groupMembers).toEqual([]);
    tracker.description = "House";
    tracker.position = 4;
    tracker.color = "amber";
    tracker.archivedAt = now;
    expect(tracker.description).toBe("House");
    expect(tracker.position).toBe(4);
    expect(tracker.color).toBe("amber");
    expect(tracker.archivedAt).toEqual(now);
    tracker.description = undefined;
    tracker.position = undefined;
    tracker.color = undefined;
    tracker.archivedAt = undefined;
    expect([tracker.description, tracker.position, tracker.color, tracker.archivedAt]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    tracker.setGroupMembers([webId]);
    expect(tracker.assigneeGroup).toBe(`${project}#members`);
    expect(tracker.groupMembers).toEqual([webId]);
    const existing = node(`${project}#this`, dataset);
    existing.setIri(`${NS.WF}assigneeGroup`, `${project}#foreign-group`);
    tracker.setGroupMembers([webId]);
    expect(tracker.assigneeGroup).toBe(`${project}#foreign-group`);
    tracker.defineCategory("Section", "Later", 3);
    tracker.defineCategory("Section", "Doing", 1);
    tracker.defineCategory("Label", "Bills", undefined, "amber");
    tracker.defineCategory("Label", "Bills");
    expect(tracker.sections.map((item) => item.name)).toEqual(["Doing", "Later"]);
    const other = createTracker(`${storage}inbox.ttl`, "Inbox", storage, [], now).tracker;
    other.defineCategory("Label", "bills");
    expect(unionLabels([tracker, other]).get("bills")).toHaveLength(2);
    expect(() => tracker.defineCategory("Label", " ")).toThrow("title");
    expect(() => tracker.setGroupMembers(["javascript:bad"])).toThrow("HTTP");
    const raw = new TaskTracker(`${project}#this`, new Store(), DataFactory);
    node(`${project}#z`, raw.dataset).iris(`${NS.RDFS}subClassOf`).add(`${project}#Section`);
    node(`${project}#a`, raw.dataset).iris(`${NS.RDFS}subClassOf`).add(`${project}#Section`);
    expect(raw.sections.map((item) => item.name)).toEqual(["", ""]);
  });
  it("retains Pod Manager descriptions, accepts HTTPS schema and writes HTTP canonical predicates", async () => {
    const dataset = await parse(
      taskUrl,
      taskFixture
        .replaceAll(SCHEMA, NS.SCHEMA)
        .replace('wf:description "Transfer before the 1st";', ""),
    );
    const task = new TaskItem(`${taskUrl}#it`, dataset, DataFactory);
    expect(task.description).toBe("Transfer before the 1st");
    expect(task.priority).toBe("high");
    expect(task.rank).toBe(3);
    task.priority = "medium";
    task.rank = 4;
    task.description = "Both apps";
    expect(node(task.id, dataset).text(`${NS.DCT}description`)).toBe("Both apps");
    expect(dataset.match(null, DataFactory.namedNode(`${NS.SCHEMA}priority`)).size).toBe(0);
    task.priority = undefined;
    task.rank = undefined;
    expect(task.priority).toBeUndefined();
    expect(task.rank).toBeUndefined();
    node(task.id, dataset).setText(`${SCHEMA}priority`, "unexpected");
    expect(task.priority).toBeUndefined();
  });
  it("writes all-day, sub-task, completion and assignment fields without affecting the parent", () => {
    const dataset = createTask(taskUrl, {
      ...details,
      allDay: "2026-11-01",
      categoryTypes: [`${project}#label-bills`],
      assignee: webId,
      parent: `${taskUrl}#parent`,
    });
    const task = new TaskItem(`${taskUrl}#it`, dataset, DataFactory);
    expect(task.allDay).toBe("2026-11-01");
    expect(task.dueDate).toEqual(new Date(2026, 10, 1));
    expect(task.reminders).toEqual([]);
    task.state = "closed";
    task.endedAt = now;
    expect(task.endedAt).toEqual(now);
    task.state = "open";
    expect(task.endedAt).toBeUndefined();
    task.allDay = undefined;
    expect(task.allDay).toBeUndefined();
    node(task.id, dataset).setDate(`${NS.SCHEDULING}dueTime`, now);
    expect(task.allDay).toBeUndefined();
    expect(
      subtaskProgress("parent", [
        { ...details, parent: "parent" },
        { ...details, parent: "parent", state: "closed" },
        details,
      ]),
    ).toEqual({ completed: 1, total: 2 });
    expect(taskDetails(taskUrl, new Store())).toBeUndefined();
  });
});
describe("validation and pure helpers", () => {
  it("rejects every Turtle IRIREF-forbidden byte before constructing extension terms", () => {
    const unsafeCharacters = Array.from({ length: 33 }, (_, code) =>
      String.fromCharCode(code),
    ).concat(["<", ">", '"', "{", "}", "|", "^", "`", "\\"]);
    const { tracker } = createTracker(project, "Home", storage, [], now);
    for (const character of unsafeCharacters) {
      const unsafe = `${storage}bad${character}iri`;
      expect(() => requireHttp(unsafe)).toThrow("HTTP");
      expect(() => tracker.setGroupMembers([unsafe])).toThrow("HTTP");
      expect(() => createTask(taskUrl, { ...details, categoryTypes: [unsafe] })).toThrow("HTTP");
      expect(() => createTracker(project, "Home", unsafe, [], now)).toThrow("HTTP");
      expect(() =>
        createTask(taskUrl, { ...details, reminders: [{ id: unsafe, offset: "PT0S" }] }),
      ).toThrow("HTTP");
    }
    const lexical = "https://POD.test:443/a/../b%20c#me";
    expect(requireHttp(lexical)).toBe(lexical);
    expect(() => requireHttp("https:pod.test")).toThrow("HTTP");
    expect(() => requireHttp("https:///pod.test")).toThrow("HTTP");
  });
  it("refuses unsafe terms at serialization without changing foreign RDF identities", async () => {
    for (const position of ["subject", "predicate", "object", "datatype"]) {
      const unsafe = `${storage}bad>iri`;
      const dataset = new Store();
      const subject = node(position === "subject" ? unsafe : taskUrl, dataset);
      const predicate = position === "predicate" ? unsafe : `${NS.DCT}source`;
      if (position === "datatype") subject.setTyped(predicate, "value", unsafe);
      else subject.setIri(predicate, position === "object" ? unsafe : "urn:source");
      expect(() => serialize(dataset)).toThrow("Unsafe RDF IRI");
    }
    const dataset = new Store();
    const lexical = "https://POD.test:443/a/../b%20c#me";
    node(taskUrl, dataset).setIri(`${NS.DCT}source`, lexical);
    node(taskUrl, dataset).setIri(`${NS.DCT}relation`, "urn:source");
    const parsed = await parse(taskUrl, await serialize(dataset));
    expect(node(taskUrl, parsed).iri(`${NS.DCT}source`)).toBe(lexical);
    expect(node(taskUrl, parsed).iri(`${NS.DCT}relation`)).toBe("urn:source");
  });
  it("normalizes slugs and uses deterministic collision suffixes", () => {
    expect(slug("  Café: Home !!! ")).toBe("cafe-home");
    expect(slug("💚")).toBe("project");
    expect(uniqueSlug("Home", ["home", "home-2", "home-3"])).toBe("home-4");
    expect(slug(`${"a".repeat(47)} b`)).toBe("a".repeat(47));
    expect(documentUrl(`${taskUrl}#it`)).toBe(taskUrl);
    expect(requireHttp(taskUrl)).toBe(taskUrl);
    for (const value of ["javascript:bad", "https://user:pass@pod.test/", "relative"])
      expect(() => requireHttp(value)).toThrow();
    expect(() => requireDate(new Date("bad"))).toThrow("date");
    expect(() => requireTitle(undefined)).toThrow("title");
    expect(() => requireTitle(" ")).toThrow("title");
    expect(positionBetween()).toEqual({ position: 0, needsRenumber: false });
    expect(positionBetween(undefined, 5).position).toBe(4);
    expect(positionBetween(5).position).toBe(6);
    expect(positionBetween(1, 2).position).toBe(1.5);
    expect(positionBetween(1, 1.00000001).needsRenumber).toBe(true);
  });
  it("rejects invalid task fields", () => {
    expect(() => validateTask(details)).not.toThrow();
    for (const data of [
      { ...details, title: "" },
      { ...details, rank: NaN },
      { ...details, dueDate: new Date("bad") },
      { ...details, creator: "urn:alice" },
      { ...details, priority: "urgent" },
      { ...details, allDay: "2026-02-30" },
      { ...details, allDay: "bad" },
      { ...details, allDay: "2026-11-03" },
      { ...details, allDay: "2026-10-30" },
      { title: "All day", state: "open", allDay: "2026-11-01" },
    ])
      expect(() => validateTask(data as TaskDetails)).toThrow();
    const inconsistent = createTask(taskUrl, { ...details, allDay: "2026-11-01" });
    node(`${taskUrl}#it`, inconsistent).setDate(`${NS.WF}dateDue`, new Date(2026, 10, 3));
    expect(() => taskDetails(taskUrl, inconsistent)).toThrow("disagree");
    validateTask({
      ...details,
      creator: webId,
      assignee: webId,
      project,
      parent: taskUrl,
      clonedFrom: taskUrl,
      duplicateOf: taskUrl,
      categoryTypes: [project],
      blockedBy: [taskUrl],
      relatesTo: [taskUrl],
      rank: 2,
      priority: "low",
      modified: now,
      endedAt: now,
    });
  });
});
describe("reminder library", () => {
  it.each([
    ["-PT1H", -3600000],
    ["P1DT2H3M4.5S", 93784500],
    ["PT0S", 0],
    ["-P1D", -86400000],
  ])("parses %s", (text, expected) => expect(offsetMilliseconds(text)).toBe(expected));
  it("rejects ambiguous or invalid reminders", () => {
    for (const text of ["P", "PT", "P1M", "P1DT", "oops"])
      expect(() => offsetMilliseconds(text)).toThrow();
    expect(() => validateReminders([{ offset: "PT0S" }], undefined)).toThrow("due date");
    expect(() => validateReminders([{ time: new Date("bad") }], now)).toThrow("date");
    expect(() => validateReminders([{ offset: "PT0S", time: now } as never], now)).toThrow(
      "exactly one",
    );
    expect(() => validateReminders([{} as never], now)).toThrow("exactly one");
    const task = node(`${taskUrl}#it`, new Store());
    const child = task.child();
    task.nodes(`${NS.SCHEDULING}hasReminder`).add(child);
    expect(() => readReminders(task)).toThrow("exactly one");
  });
  it("round-trips both triggers, computes fire times and suppresses fired keys", async () => {
    const dataset = createTask(taskUrl, {
      ...details,
      reminders: [{ offset: "-PT1H" }, { time: now }],
    });
    const task = new TaskItem(`${taskUrl}#it`, dataset, DataFactory);
    const reminders = task.reminders;
    expect(reminders[0]?.offset).toBe("-PT1H");
    expect(reminders[1]?.time).toEqual(now);
    const times = computeFireTimes(task.id, task.dueDate, reminders);
    expect(times[0]?.at.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(
      pendingReminders(times, new Date("2027-01-01"), new Set(times.map((time) => time.key))),
    ).toEqual([]);
    expect(pendingReminders(times, now, new Set())).toEqual([times[1]]);
    expect(computeFireTimes(task.id, now, [{ offset: "PT0S" }])[0]?.id).toBe(
      `${task.id}/reminder-PT0S`,
    );
    const again = await parse(taskUrl, await serialize(dataset));
    expect(
      computeFireTimes(
        task.id,
        task.dueDate,
        new TaskItem(task.id, again, DataFactory).reminders,
      ).map((time) => time.key),
    ).toEqual(times.map((time) => time.key));
    task.reminders = [{ offset: "PT0S" }];
    expect(task.reminders).toHaveLength(1);
    task.reminders = [];
    expect(task.reminders).toEqual([]);
    const named = node(`${taskUrl}#reminder`, dataset);
    named.setDate(`${NS.SCHEDULING}triggerTime`, now);
    node(task.id, dataset).nodes(`${NS.SCHEDULING}hasReminder`).add(named);
    expect(task.reminders[0]?.id).toBe(named.value);
    expect(shiftReminders([{ id: "a", time: now }, { offset: "-PT1H" }], 1000)).toEqual([
      { id: "a", time: new Date(now.getTime() + 1000) },
      { offset: "-PT1H" },
    ]);
    writeReminders(node(task.id, dataset), [], now);
  });
});
describe("completion roll-forward", () => {
  const recurring = {
    ...details,
    dueDate: new Date(2026, 10, 1),
    allDay: "2026-11-01",
    recurrence: { frequency: "DAILY" as const, interval: 2 },
    categoryTypes: [`${project}#section-doing`],
    reminders: [{ time: now }, { offset: "-PT1H" }],
  };
  it("copies the completed occurrence, preserves fields and advances the open original", () => {
    const result = planCompletion(recurring, `${taskUrl}#it`, now);
    expect(result.copy).toMatchObject({
      title: details.title,
      state: "closed",
      endedAt: now,
      clonedFrom: `${taskUrl}#it`,
      dueDate: recurring.dueDate,
      categoryTypes: recurring.categoryTypes,
    });
    expect(result.copy?.recurrence).toBeUndefined();
    expect(result.copy?.reminders).toEqual([]);
    expect(result.original.dueDate?.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(result.original.allDay).toBe("2026-11-03");
    expect(result.original.reminders?.[0]?.time).toEqual(new Date(now.getTime() + 2 * 86400000));
    expect(recurring.dueDate).toEqual(new Date(2026, 10, 1));
    const noDue = planCompletion(
      { title: "Repeat", state: "open", recurrence: { frequency: "DAILY" } },
      taskUrl,
      now,
    );
    expect(noDue.original.dueDate?.getTime()).toBe(now.getTime() + 86400000);
    expect(noDue.original.allDay).toBeUndefined();
  });
  it("keeps the intended time after completing across a DST gap", () => {
    const data: TaskDetails = {
      ...details,
      dueDate: new Date(2026, 2, 28, 1, 30),
      recurrence: { frequency: "DAILY" },
      reminders: [{ time: new Date(2026, 2, 28, 0, 30) }, { offset: "-PT1H" }],
    };
    const first = planCompletion(data, taskUrl, now).original;
    expect(first.dueDate).toEqual(new Date(2026, 2, 30, 1, 30));
    const second = planCompletion(first, taskUrl, now).original;
    expect(second.dueDate).toEqual(new Date(2026, 2, 31, 1, 30));
    const times = computeFireTimes(taskUrl, second.dueDate, second.reminders ?? []);
    expect(times.map((time) => time.at)).toEqual([
      new Date(2026, 2, 31, 0, 30),
      new Date(2026, 2, 31, 0, 30),
    ]);
  });
  it.each([
    "2026-11-01",
    "2026-07-01",
  ])("advances an all-day date created in London and completed in New York: %s", (allDay) => {
    const dataset = createTask(taskUrl, {
      ...details,
      allDay,
      dueDate: new Date(`${allDay}T00:00:00Z`),
      recurrence: { frequency: "DAILY" },
    });
    const london = taskDetails(taskUrl, dataset) as TaskDetails;
    const oldDue = london.dueDate as Date;
    const absolute = new Date(oldDue.getTime() - 3600000);
    const previousZone = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const data = taskDetails(taskUrl, dataset) as TaskDetails;
      validateTask(data);
      const result = planCompletion(
        { ...data, reminders: [{ time: absolute }, { offset: "-PT1H" }] },
        taskUrl,
        now,
      );
      const expectedDay = allDay.replace(/01$/, "02");
      expect(result.original.allDay).toBe(expectedDay);
      const expected = new Date(`${expectedDay}T00:00:00`);
      expect(result.original.dueDate).toEqual(expected);
      validateTask(result.original);
      const times = computeFireTimes(taskUrl, expected, result.original.reminders ?? []);
      expect(times.map((time) => time.at.getTime())).toEqual([
        expected.getTime() - 3600000,
        expected.getTime() - 3600000,
      ]);
      const reread = taskDetails(taskUrl, createTask(taskUrl, result.original));
      expect(reread?.allDay).toBe(expectedDay);
      expect(reread?.dueDate).toEqual(expected);
      expect(result.copy?.allDay).toBe(allDay);
      expect(result.copy?.dueDate).toEqual(oldDue);
    } finally {
      process.env.TZ = previousZone;
    }
  });
  it("closes normal, exhausted and complete-forever tasks", () => {
    for (const result of [
      planCompletion(details, taskUrl, now),
      planCompletion({ ...recurring, state: "closed" }, taskUrl, now),
      planCompletion(recurring, taskUrl, now, 0, true),
      planCompletion(
        { ...recurring, recurrence: { frequency: "DAILY", count: 2 } },
        taskUrl,
        now,
        1,
      ),
      planCompletion(
        { ...recurring, recurrence: { frequency: "DAILY", until: now } },
        taskUrl,
        now,
      ),
    ]) {
      expect(result.copy).toBeUndefined();
      expect(result.original.state).toBe("closed");
    }
    expect(() => planCompletion(recurring, taskUrl, now, -1)).toThrow("count");
    expect(
      planCompletion({ ...recurring, recurrence: { frequency: "DAILY", count: 2 } }, taskUrl, now)
        .copy,
    ).toBeDefined();
  });
});

it("keeps fired reminder identities stable after RDF reordering and removal", () => {
  const taskId = `${taskUrl}#it`;
  const reminders = [{ offset: "-PT1H" }, { offset: "PT0S" }, { time: now }];
  const times = computeFireTimes(taskId, now, reminders);
  const fired = new Set(times.map((time) => time.key));
  const reordered = computeFireTimes(taskId, now, [
    reminders[2] as { time: Date },
    reminders[0] as { offset: string },
  ]);
  expect(pendingReminders(reordered, now, fired)).toEqual([]);
  const item = new TaskItem(
    taskId,
    createTask(taskUrl, { title: "Reminder", state: "open", dueDate: now, reminders }),
    DataFactory,
  );
  item.reminders = [item.reminders[2] as { time: Date }, item.reminders[0] as { offset: string }];
  expect(new Set(computeFireTimes(taskId, now, item.reminders).map((time) => time.key))).toEqual(
    new Set([times[2]?.key, times[0]?.key]),
  );
});

it("round-trips recurrence through TaskItem and validates remaining reminders on due removal", () => {
  const dataset = createTask(taskUrl, {
    ...details,
    recurrence: { frequency: "DAILY", interval: 2 },
    reminders: [{ offset: "PT0S" }],
  });
  const task = new TaskItem(`${taskUrl}#it`, dataset, DataFactory);
  expect(task.recurrence).toMatchObject({ frequency: "DAILY", interval: 2 });
  task.recurrence = undefined;
  expect(task.recurrence).toBeUndefined();
  expect(() =>
    validateTask({ title: "No due", state: "open", reminders: [{ offset: "PT0S" }] }),
  ).toThrow("due date");
  expect(() => (task.allDay = "invalid")).toThrow("all-day");
  expect(() => (task.reminders = [{ id: "urn:reminder", offset: "PT0S" }])).toThrow("HTTP");
});
