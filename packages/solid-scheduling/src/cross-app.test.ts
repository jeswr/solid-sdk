// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// The federation demo: a scheduling Task written by this package (a Vikunja→Solid
// fork) MUST ALSO read back as a shared wf:Task through @jeswr/solid-task-model —
// so the SAME pod resource surfaces "assigned to me" in the Pod Manager /
// solid-issues. This is the whole point of the cross-serialisation; if this test
// fails, the federation edge is broken.
import { parseRdf } from "@jeswr/fetch-rdf";
import { isAssignedTo, parseTask, taskSubject } from "@jeswr/solid-task-model/task";
import { describe, expect, it } from "vitest";
import { schedulingTaskSubject, serializeSchedulingTask } from "./task.js";

const RES = "https://alice.pod.example/vikunja/tasks/42";
const BOB = "https://bob.pod.example/profile/card#me";
const ALICE = "https://alice.pod.example/profile/card#me";

describe("cross-app federation — a Vikunja sched:Task reads as a wf:Task", () => {
  it("the same #it subject carries both vocabularies", () => {
    // The two models MUST agree on the subject IRI, else the wf overlay lands on
    // a different node and the federation read sees nothing.
    expect(schedulingTaskSubject(RES)).toBe(taskSubject(RES));
  });

  it("a scheduling task is readable by the Pod Manager's parseTask (assigned-to-me)", async () => {
    const ttl = await serializeSchedulingTask(RES, {
      summary: "Review the PR",
      description: "Look at #128",
      dueTime: new Date("2026-07-09T12:00:00.000Z"),
      assignee: BOB,
      organizer: ALICE,
      priority: "high",
      position: 2,
      completed: false,
    });

    // Parse with the SHARED task model — exactly what the Pod Manager does.
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const task = parseTask(RES, ds);

    expect(task).toBeDefined();
    expect(task?.title).toBe("Review the PR"); // sched:summary → dct:title
    expect(task?.description).toBe("Look at #128");
    expect(task?.state).toBe("open"); // sched:completed=false → wf:Open
    expect(task?.assignee).toBe(BOB); // wf:assignee — the federation edge
    expect(task?.creator).toBe(ALICE); // sched:organizer → dct:creator
    expect(task?.dueDate?.toISOString()).toBe("2026-07-09T12:00:00.000Z");
    expect(task?.priority).toBe("high");
    expect(task?.rank).toBe(2); // position → schema:position

    // The Pod Manager's "assigned to me" gate.
    expect(isAssignedTo(task?.assignee, BOB)).toBe(true);
    expect(isAssignedTo(task?.assignee, ALICE)).toBe(false);
  });

  it("a completed scheduling task reads as a closed wf:Task", async () => {
    const ttl = await serializeSchedulingTask(RES, {
      summary: "Shipped",
      completed: true,
      completedAt: new Date("2026-07-08T10:00:00.000Z"),
    });
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const task = parseTask(RES, ds);
    expect(task?.state).toBe("closed"); // sched:completed=true → wf:Closed
    expect(task?.endedAt?.toISOString()).toBe("2026-07-08T10:00:00.000Z"); // prov:endedAtTime
  });

  it("cross-model relations (parent / blocked-by) federate through wf:Task", async () => {
    const parent = "https://alice.pod.example/vikunja/tasks/1";
    const blocker = "https://alice.pod.example/vikunja/tasks/2";
    const ttl = await serializeSchedulingTask(RES, {
      summary: "Subtask",
      parent,
      blockedBy: [blocker],
    });
    const ds = await parseRdf(ttl, "text/turtle", { baseIRI: RES });
    const task = parseTask(RES, ds);
    expect(task?.parent).toBe(parent);
    expect(task?.blockedBy).toEqual([blocker]);
  });
});
