// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import { Store, DataFactory } from "n3";
import {
  columnOpenCount,
  wipLevel,
  boardWip,
  wipMoveBreach,
  boardColumns,
} from "./board";
import { Tracker, DEFAULT_WORKFLOW, type WipLimits } from "./issue";
import type { IssueRecord } from "./repository";

const DOC = "https://pod.example/issues/tracker.ttl";
const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
  components: [],
  blockedBy: [],
  relatesTo: [],
  attachments: [],
  comments: [],
  worklog: [],
  loggedSeconds: 0,
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });

describe("WIP limits — persistence round-trip on the wf:State class (#111)", () => {
  it("setWipLimit writes tm:wipMin/tm:wipMax and wipLimits reads them back", () => {
    const store = new Store();
    const tracker = new Tracker(`${DOC}#this`, store, DataFactory);
    tracker.configure("Demo"); // declares the default To Do / In Progress / Done states
    tracker.setWipLimit("in-progress", { min: 1, max: 3 });
    expect(tracker.wipLimits).toEqual({ "in-progress": { min: 1, max: 3 } });
    // The bounds live on the #status-in-progress wf:State class as nonNegativeInteger.
    const iri = `${DOC}#status-in-progress`;
    const objs = (pred: string) =>
      [...store.match(DataFactory.namedNode(iri), DataFactory.namedNode(pred))].map((q) => q.object);
    const TM = "https://w3id.org/jeswr/task#";
    const min = objs(`${TM}wipMin`)[0];
    expect(min?.value).toBe("1");
    expect((min as { datatype?: { value: string } })?.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#nonNegativeInteger");
  });

  it("clears a bound when set to undefined, and ignores negative / non-integer values", () => {
    const store = new Store();
    const tracker = new Tracker(`${DOC}#this`, store, DataFactory);
    tracker.configure("Demo");
    tracker.setWipLimit("in-progress", { min: 2, max: 5 });
    tracker.setWipLimit("in-progress", { min: undefined, max: 5 });
    expect(tracker.wipLimits).toEqual({ "in-progress": { max: 5 } });
    // Negative / fractional are dropped (untrusted input hardening + floor).
    tracker.setWipLimit("in-progress", { min: -3, max: 4.9 });
    expect(tracker.wipLimits).toEqual({ "in-progress": { max: 4 } });
  });

  it("never mints WIP bounds on a status slug the workflow does not declare", () => {
    const store = new Store();
    const tracker = new Tracker(`${DOC}#this`, store, DataFactory);
    tracker.configure("Demo");
    tracker.setWipLimit("does-not-exist", { max: 3 });
    expect(tracker.wipLimits["does-not-exist"]).toBeUndefined();
  });
});

describe("WIP board logic (#111)", () => {
  it("columnOpenCount counts only not-closed cards in the column", () => {
    const issues = [
      mk({ url: "1", status: "in-progress" }),
      mk({ url: "2", status: "in-progress" }),
      mk({ url: "3", status: "in-progress", state: "closed" }), // closed in column → not counted
      mk({ url: "4", status: "todo" }),
    ];
    expect(columnOpenCount(issues, "in-progress")).toBe(2);
    expect(columnOpenCount(issues, "todo")).toBe(1);
  });

  it("wipLevel classifies under / ok / over", () => {
    expect(wipLevel(0, undefined)).toBe("ok");
    expect(wipLevel(0, { min: 1 })).toBe("under");
    expect(wipLevel(2, { min: 1, max: 3 })).toBe("ok");
    expect(wipLevel(4, { min: 1, max: 3 })).toBe("over");
  });

  it("boardWip reports per-column count/level for status columns", () => {
    const limits: WipLimits = { "in-progress": { min: 1, max: 2 } };
    const issues = [
      mk({ url: "1", status: "in-progress" }),
      mk({ url: "2", status: "in-progress" }),
      mk({ url: "3", status: "in-progress" }), // 3 open → over max 2
    ];
    const cols = boardColumns(DEFAULT_WORKFLOW, "status");
    const wip = boardWip(issues, cols, limits);
    expect(wip["in-progress"]).toEqual({ count: 3, limit: { min: 1, max: 2 }, level: "over" });
    expect(wip["todo"].level).toBe("ok"); // no limit
  });
});

describe("WIP move-guard (#111) — warn, never block", () => {
  const limits: WipLimits = { "in-progress": { max: 2 } };
  it("warns when a move would push the target column over its max", () => {
    const issues = [
      mk({ url: "a", status: "in-progress" }),
      mk({ url: "b", status: "in-progress" }),
      mk({ url: "moving", status: "todo" }),
    ];
    const breach = wipMoveBreach(issues, "moving", "in-progress", limits, DEFAULT_WORKFLOW);
    expect(breach).toEqual({ count: 3, max: 2 });
  });

  it("does not warn for a move within the same column or when under the max", () => {
    const issues = [mk({ url: "a", status: "in-progress" }), mk({ url: "moving", status: "in-progress" })];
    expect(wipMoveBreach(issues, "moving", "in-progress", limits, DEFAULT_WORKFLOW)).toBeUndefined();
    const under = [mk({ url: "moving", status: "todo" })];
    expect(wipMoveBreach(under, "moving", "in-progress", limits, DEFAULT_WORKFLOW)).toBeUndefined();
  });

  it("never warns moving into a terminal (done) column — completing adds no in-flight work", () => {
    const limits2: WipLimits = { done: { max: 0 } };
    const issues = [mk({ url: "moving", status: "in-progress" })];
    expect(wipMoveBreach(issues, "moving", "done", limits2, DEFAULT_WORKFLOW)).toBeUndefined();
  });

  it("no warning when the target column has no max", () => {
    const issues = [mk({ url: "moving", status: "todo" })];
    expect(wipMoveBreach(issues, "moving", "todo", limits, DEFAULT_WORKFLOW)).toBeUndefined();
  });
});
