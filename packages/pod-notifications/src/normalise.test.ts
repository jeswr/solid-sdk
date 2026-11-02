// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, test } from "vitest";
import { createChangeNormalizer } from "./normalise.js";

const root = "https://pod.example/alice/";
const storage = createMemoryStorage({ protocol: "lws", root });
const storageId = "https://pod.example/storage-id";
const frame = { type: "Update", object: `${root}note`, id: "a" };
function normalizer() {
  let time = 1_000;
  return {
    parse: createChangeNormalizer({
      storageId,
      isWithinStorage: storage.isWithinStorage.bind(storage),
      via: "sse",
      now: () => time,
    }),
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("untrusted notification normalisation", () => {
  test("normalises Solid AS2 and preserves optional fields and raw input", () => {
    const raw = {
      type: ["Unknown", "https://www.w3.org/ns/activitystreams#Add", "Update"],
      object: { id: `${root}note`, type: ["DataResource"] },
      target: { id: root },
      origin: root,
      actor: { id: "https://person.example/#me" },
      published: "2026-10-01T00:00:00Z",
      state: '"etag"',
    };
    expect(normalizer().parse(raw)).toEqual([
      {
        type: "Add",
        object: `${root}note`,
        objectKind: "resource",
        target: root,
        origin: root,
        actor: "https://person.example/#me",
        published: new Date(raw.published),
        state: '"etag"',
        id: expect.any(String),
        via: "sse",
        raw,
      },
    ]);
  });

  test.each([
    "Notification",
    "https://www.w3.org/ns/lws#Notification",
  ])("unwraps LWS %s batches and individual activities", (type) => {
    const n = normalizer();
    const raw = {
      type: [type],
      storage: storageId,
      activity: [frame, { type: ["Move"], object: { id: root, type: "Container" }, id: "b" }],
    };
    const events = n.parse(raw);
    expect(events.map((event) => event.type)).toEqual(["Update", "Move"]);
    expect(events[1]?.objectKind).toBe("container");
    expect(events[0]?.raw).toBe(raw);
    expect(n.parse({ type, storage: storageId, activity: { ...frame, id: "c" } })).toHaveLength(1);
  });

  test.each([
    null,
    [],
    "text",
    1,
    { type: "Bogus" },
    { ...frame, type: [null, 3, {}] },
    { ...frame, object: null },
    { ...frame, object: "" },
    { ...frame, object: { id: 42 } },
    { ...frame, published: "bad" },
    { type: "Notification", storage: storageId },
    { type: "Notification", storage: "https://evil.example/", activity: frame },
    { type: "Notification", activity: frame },
  ])("drops malformed input %#", (raw) => {
    expect(normalizer().parse(raw)).toEqual([]);
  });

  test.each([
    "https://evil.example/note",
    "https://pod.example/alice-other/note",
    "https://pod.example/alice/%2e%2e/secret",
    "https://user:pass@pod.example/alice/note",
    "https://:pass@pod.example/alice/note",
    "https://pod.example/alice/\nnote",
    "https://pod.example/alice/\\note",
    "https://[invalid/alice/note",
    "https:pod.example/alice/note",
    "file:///alice/note",
    "/alice/note",
  ])("drops foreign/unsafe object %s without poisoning dedupe", (object) => {
    const n = normalizer();
    expect(n.parse({ ...frame, object })).toEqual([]);
    expect(n.parse(frame)).toHaveLength(1);
  });

  test("filters foreign auxiliary scope, accepts external actor, ignores malformed optional fields", () => {
    const n = normalizer();
    expect(
      n.parse({
        ...frame,
        object: { id: frame.object, type: 7 },
        target: "https://evil.example/",
        origin: null,
        actor: {},
        state: 5,
      })[0],
    ).toMatchObject({ objectKind: "unknown" });
    const [event] = n.parse({
      ...frame,
      id: "b",
      origin: "https://evil.example/",
      actor: "https://external.example/me",
    });
    expect(event).not.toHaveProperty("origin");
    expect(event).not.toHaveProperty("target");
    expect(event).not.toHaveProperty("state");
    expect(event?.actor).toBe("https://external.example/me");
  });

  test.each([
    "Create",
    "Update",
    "Delete",
    "Move",
    "Add",
    "Remove",
  ])("keeps known verb %s", (type) => {
    expect(normalizer().parse({ ...frame, type })[0]?.type).toBe(type);
  });

  test.each([
    "Container",
    "https://www.w3.org/ns/lws#Container",
    "http://www.w3.org/ns/ldp#Container",
    "http://www.w3.org/ns/ldp#BasicContainer",
  ])("recognises container type %s", (type) => {
    expect(normalizer().parse({ ...frame, object: { id: root, type } })[0]?.objectKind).toBe(
      "container",
    );
  });

  test.each([
    "DataResource",
    "https://www.w3.org/ns/lws#DataResource",
    "http://www.w3.org/ns/ldp#Resource",
    "http://www.w3.org/ns/ldp#RDFSource",
    "http://www.w3.org/ns/ldp#NonRDFSource",
  ])("recognises resource type %s", (type) => {
    expect(normalizer().parse({ ...frame, object: { id: root, type } })[0]?.objectKind).toBe(
      "resource",
    );
  });

  test("dedupes ids across frames and batches for exactly 5 seconds; distinct ids survive", () => {
    const n = normalizer();
    expect(n.parse(frame)).toHaveLength(1);
    n.advance(4_999);
    expect(n.parse(frame)).toEqual([]);
    const activity = [null, frame, { ...frame, id: "b" }, { ...frame, id: "c" }];
    expect(
      n.parse({ type: "Notification", storage: storageId, activity }).map((e) => e.id),
    ).toEqual(["b", "c"]);
    n.advance(1);
    expect(n.parse(frame)).toHaveLength(1);
    expect(n.parse({ ...frame, id: "b" })).toEqual([]);
    n.advance(5_000);
    expect(n.parse({ ...frame, id: "b" })).toHaveLength(1);
  });

  test.each([
    "2026-11-01T00:00:00Z",
    undefined,
  ])("preserves ID-less updates with distinct ETags at the same timestamp (%s)", (published) => {
    const n = normalizer();
    const activity = { type: "Update", object: frame.object, published };
    const first = n.parse({ ...activity, state: '"first"' });
    const second = n.parse({ ...activity, state: '"second"' });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.state).toBe('"first"');
    expect(second[0]?.state).toBe('"second"');
    expect(second[0]?.published).toEqual(first[0]?.published);
    expect(second[0]?.id).not.toBe(first[0]?.id);
  });

  test.each([
    "2026-11-01T00:00:00Z",
    undefined,
  ])("preserves an ID-less Remove/Add pair in an LWS batch at the same timestamp (%s)", (published) => {
    const n = normalizer();
    const raw = {
      type: "Notification",
      storage: storageId,
      activity: [
        { type: "Remove", object: frame.object, origin: root, published },
        { type: "Add", object: frame.object, target: root, published },
      ],
    };
    const events = n.parse(raw);
    expect(events.map((event) => event.type)).toEqual(["Remove", "Add"]);
    expect(events[0]).toMatchObject({ object: frame.object, origin: root, raw });
    expect(events[1]).toMatchObject({ object: frame.object, target: root, raw });
    expect(events[1]?.id).not.toBe(events[0]?.id);
  });

  test("repeated ID-less activities receive fresh IDs even with identical semantics", () => {
    const n = normalizer();
    const activity = { type: "Update", object: root };
    const first = n.parse(activity);
    const second = n.parse(activity);
    n.advance(5_000);
    const third = n.parse(activity);
    expect([first.length, second.length, third.length]).toEqual([1, 1, 1]);
    expect(new Set([...first, ...second, ...third].map((event) => event.id)).size).toBe(3);
  });

  test("synthesised IDs do not suppress publisher IDs", () => {
    const n = normalizer();
    const activity = { type: "Update", object: root };
    const [generated] = n.parse(activity);
    expect(generated).toBeDefined();
    const supplied = { ...activity, id: generated?.id };
    expect(n.parse(supplied)).toHaveLength(1);
    expect(n.parse(supplied)).toEqual([]);
    expect(n.parse(activity)).toHaveLength(1);
  });

  test.each([
    undefined,
    null,
    "",
    7,
    {},
  ])("uses the wall clock and a fresh id for invalid/absent id %s", (id) => {
    const parse = createChangeNormalizer({
      storageId,
      isWithinStorage: () => true,
      via: "websocket",
    });
    const [event] = parse({ type: "Update", object: root, id });
    expect(event?.published.getTime()).toBeLessThanOrEqual(Date.now());
    expect(event?.id).toEqual(expect.any(String));
  });

  test("distinct ids for the same object and timestamp survive regardless of id spelling", () => {
    const n = normalizer();
    const ids = [
      "__proto__",
      "constructor",
      "toString",
      ...Array.from({ length: 500 }, (_, i) => `id-${i}`),
    ];
    const raw = {
      type: "Notification",
      storage: storageId,
      activity: ids.map((id) => ({ ...frame, id })),
    };
    expect(n.parse(raw).map((event) => event.id)).toEqual(ids);
    expect(n.parse(raw)).toEqual([]);
    n.advance(5_000);
    expect(n.parse(raw).map((event) => event.id)).toEqual(ids);
  });
});
