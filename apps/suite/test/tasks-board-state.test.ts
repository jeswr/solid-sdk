// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Synthetic fixtures define these optional fields explicitly.
import { describe, expect, it } from "vitest";
import {
  BoardError,
  type BoardViewState,
  decodeViewState,
  encodeViewState,
} from "../src/apps/tasks/lib/board";

function expectError(fn: () => unknown, code: BoardError["code"] = "invalid-input") {
  expect(fn).toThrow(BoardError);
  expect(fn).toThrow(expect.objectContaining({ name: "BoardError", code }));
}

describe("view-state persistence", () => {
  const full: BoardViewState = {
    filter: {
      query: "Zoë's picnic 🧺 & tea / + #? %=!()*\n\ud800",
      statuses: ["todo", "doing"],
      labels: ["café", "家"],
      priorities: [4, 1, 2, 3],
      project: "https://example.org/projects/picnic#this",
    },
    sort: "priority",
  };

  it.each(["manual", "due", "priority", "name"] as const)("round trips %s sort", (sort) => {
    const state = { ...full, sort };
    const encoded = encodeViewState(state);
    expect(decodeViewState(encoded)).toEqual(state);
    expect(decodeViewState(encoded)).not.toBe(state);
    expect(decodeViewState(encoded).filter.labels).not.toBe(full.filter.labels);
    expect(encoded).not.toMatch(/[\s/#?&=+]/);
    expect(new URL(`https://example.org/?view=${encoded}`).searchParams.get("view")).toBe(
      decodeURIComponent(encoded),
    );
    expect(new URL(`https://example.org/tasks/${encoded}`).pathname.slice(7)).toBe(encoded);
    // URLSearchParams adds the outer transport escaping and removes it on read.
    const url = new URL("https://example.org/tasks");
    url.searchParams.set("view", encoded);
    expect(decodeViewState(url.searchParams.get("view")!)).toEqual(state);
  });

  it("preserves empty filters, empty lists, empty text and serializes keys in stable order", () => {
    for (const filter of [{}, { query: "", statuses: [], labels: [], priorities: [] }]) {
      expect(decodeViewState(encodeViewState({ filter, sort: "manual" }))).toEqual({
        filter,
        sort: "manual",
      });
    }
    expect(
      encodeViewState({
        sort: full.sort,
        filter: { project: full.filter.project!, query: full.filter.query! },
      }),
    ).toBe(
      encodeViewState({
        filter: { query: full.filter.query!, project: full.filter.project! },
        sort: full.sort,
      }),
    );
  });

  const invalid = [
    null,
    [],
    1,
    {},
    { filter: {} },
    { filter: {}, sort: "random" },
    { filter: {}, sort: "manual", unknown: true },
    { filter: { unknown: true }, sort: "manual" },
    { filter: null, sort: "manual" },
    { filter: [], sort: "manual" },
    { filter: { query: 1 }, sort: "manual" },
    { filter: { query: undefined }, sort: "manual" },
    { filter: { project: " " }, sort: "manual" },
    { filter: { statuses: "todo" }, sort: "manual" },
    { filter: { labels: ["café", "café"] }, sort: "manual" },
    { filter: { statuses: [""] }, sort: "manual" },
    { filter: { priorities: "1" }, sort: "manual" },
    { filter: { priorities: [0] }, sort: "manual" },
    { filter: { priorities: [1, 1] }, sort: "manual" },
    { filter: { priorities: ["1"] }, sort: "manual" },
    { filter: { priorities: [1.5] }, sort: "manual" },
    { filter: { priorities: Array(1) }, sort: "manual" },
    { filter: {}, sort: "manual", [Symbol("unknown")]: true },
    Object.assign(Object.create({ hidden: true }), { filter: {}, sort: "manual" }),
  ];
  it.each(invalid.map((value, i) => [i, value]))("rejects unsupported state %s", (_, value) => {
    expectError(() => encodeViewState(value as BoardViewState));
  });

  it.each([
    "",
    "v2.%7B%7D",
    "v1.%",
    "v1.%FF",
    "v1.not-json",
    "v1.null",
    "v1.%7B%22filter%22%3A%7B%7D%2C%22sort%22%3A%22manual%22%2C%22unknown%22%3Atrue%7D",
    `v1.${encodeURIComponent('{"filter":{},"sort":"name","sort":"manual"}')}`,
    `v1.${encodeURIComponent('{"filter":{}, "sort":"manual"}')}`,
    `v1.${encodeURIComponent('{"filter":{"__proto__":{}},"sort":"manual"}')}`,
    undefined,
    1,
  ])("rejects malformed, unknown, duplicate or noncanonical encoded input %s", (encoded) => {
    expectError(() => decodeViewState(encoded as string), "invalid-state");
  });
});
