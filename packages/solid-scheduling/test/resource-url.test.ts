// AUTHORED-BY Claude Opus 5.5
// sst-ild.7.9: subject helpers, build and serialize reject an unsafe resource URL before
// minting IRIs; parse returns undefined instead of throwing.
import { Parser, Store } from "n3";
import { expect, it } from "vitest";
import {
  buildCalendar,
  buildSchedulingTask,
  calendarSubject,
  parseCalendar,
  parseSchedulingTask,
  reminderIri,
  schedulingNodeIris,
  schedulingTaskSubject,
} from "../src/index.js";

const BAD = [
  "https://a.example/t#frag",
  "tasks/x",
  "javascript:alert(1)",
  "https://a.example/b> <x:y> <x:z",
];

it("subject helpers and builds throw on an unsafe resource URL", () => {
  for (const url of BAD) {
    expect(() => schedulingTaskSubject(url)).toThrow(TypeError);
    expect(() => schedulingNodeIris(url)).toThrow(TypeError);
    expect(() => reminderIri(url, 0)).toThrow(TypeError);
    expect(() => calendarSubject(url)).toThrow(TypeError);
    expect(() => buildSchedulingTask(url, { summary: "x" })).toThrow(TypeError);
    expect(() => buildCalendar(url, { summary: "x" })).toThrow(TypeError);
  }
});

it("parse returns undefined for an unsafe resource URL instead of throwing", () => {
  const ttl = `@prefix sched: <https://w3id.org/jeswr/sectors/scheduling#> .
    <https://a.example/t#frag#it> a sched:Task, sched:Calendar ; sched:summary "x" .`;
  const ds = new Store(new Parser().parse(ttl));
  for (const url of BAD) {
    expect(parseSchedulingTask(url, ds)).toBeUndefined();
    expect(parseCalendar(url, ds)).toBeUndefined();
  }
});
