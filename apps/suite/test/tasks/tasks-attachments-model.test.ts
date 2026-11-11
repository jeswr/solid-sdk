// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { duplicateTaskData, projectMoveData } from "../../src/apps/tasks/lib/detail/task-data";
import { DataFactory, Node, NS, node, SCHEMA, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { createTask, TaskItem, taskDetails } from "../../src/apps/tasks/lib/model/task";
import { storage, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const first = `${storage}drive/Project%20brief.pdf`;
const second = "https://example.org/notes?version=2#section";
const url = `${storage}tasks/projects/inbox/task.ttl`;
const invalid = [
  "javascript:alert(1)",
  "data:text/plain,hello",
  "/relative",
  "notes.pdf",
  "ftp://example.org/file",
  "https://user:secret@example.org/file",
];

describe("task attachment model", () => {
  it("also accepts HTTP links without fetching their contents", async () => {
    const { store, pod, inbox } = await frameCache();
    const link = "http://example.org/brief.pdf";
    const item = await store.createTask(inbox, {
      title: "Task",
      state: "open",
      attachments: [link],
    });
    expect((await store.readTask(item.url)).task.attachments).toEqual([link]);
    expect(pod.requests.some((request) => request.url === link)).toBe(false);
  });
  it("round-trips IRI values through conditional writes and retains them across detail edits", async () => {
    const { pod, store, inbox } = await frameCache();
    const created = await store.createTask(inbox, {
      title: "Read brief",
      state: "open",
      attachments: [first],
    });
    expect((await store.readTask(created.url)).task.attachments).toEqual([first]);
    const updated = await store.updateTask(created, (task) => {
      task.attachments = [...task.attachments, second, first];
    });
    const put = pod.mutations().at(-1);
    expect(put?.url).toBe(created.url);
    expect(put?.headers.get("If-Match")).toBe(created.etag);
    const dataset = await pod.dataset(created.url);
    const triples = [
      ...dataset.match(
        DataFactory.namedNode(created.task.id),
        DataFactory.namedNode(`${SCHEMA}associatedMedia`),
      ),
    ];
    expect(triples.map((quad) => [quad.object.termType, quad.object.value])).toEqual([
      ["NamedNode", first],
      ["NamedNode", second],
    ]);
    const edited = await store.updateTask(updated, (task) => {
      task.description = "Read before Monday";
    });
    expect((await store.readTask(edited.url)).task.attachments).toEqual([first, second]);
    expect(taskDetails(edited.url, edited.dataset)?.attachments).toEqual([first, second]);
    const removed = await store.updateTask(edited, (task) => {
      task.attachments = [];
    });
    expect((await store.readTask(removed.url)).task.attachments).toEqual([]);
    expect(pod.mutations().at(-1)?.headers.get("If-Match")).toBe(edited.etag);
  });

  it.each(
    invalid,
  )("rejects %s on creation and accessor assignment without partial changes", (value) => {
    expect(() => createTask(url, { title: "Task", state: "open", attachments: [value] })).toThrow(
      TypeError,
    );
    const dataset = createTask(url, { title: "Task", state: "open", attachments: [first] });
    const task = new TaskItem(`${url}#it`, dataset, DataFactory);
    expect(() => {
      task.attachments = [second, value];
    }).toThrow(TypeError);
    expect(task.attachments).toEqual([first]);
  });

  it("ignores invalid stored values, accepts both schema schemes and replaces aliases", async () => {
    const dataset = createTask(url, { title: "Task", state: "open" });
    const subject = node(`${url}#it`, dataset);
    for (const predicate of [`${SCHEMA}associatedMedia`, `${NS.SCHEMA}associatedMedia`]) {
      for (const value of [first, second, ...invalid]) subject.iris(predicate).add(value);
      subject.nodes(predicate).add(subject.child());
      subject.nodes(predicate).add(new Node(DataFactory.literal(first), dataset, DataFactory));
    }
    const task = new TaskItem(`${url}#it`, dataset, DataFactory);
    expect(task.attachments).toEqual([first, second]);
    task.attachments = [second];
    expect(subject.nodes(`${NS.SCHEMA}associatedMedia`).size).toBe(0);
    expect(task.attachments).toEqual([second]);
    expect(await serialize(dataset)).not.toContain("javascript:");
  });

  it("retains attachment links when duplicating and moving projects", async () => {
    const { store, inbox } = await frameCache();
    const target = await store.createProject("Target");
    const task = await store.createTask(inbox, {
      title: "Read brief",
      state: "open",
      attachments: [first, second],
    });
    const duplicate = await store.createTask(inbox, duplicateTaskData(task, webId));
    expect(duplicate.task.attachments).toEqual([first, second]);
    expect(projectMoveData(task, inbox, target).attachments).toEqual([first, second]);
    const moved = await store.moveTaskToProject(task, inbox, target);
    expect((await store.readTask(moved.url)).task.attachments).toEqual([first, second]);
  });
});
