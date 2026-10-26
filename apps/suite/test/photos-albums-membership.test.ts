// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AlbumError,
  type AlbumMember,
  addMember,
  removeMember,
  reorderMember,
  selectCover,
} from "../src/apps/photos/lib/albums";

const a = "https://example.org/photos/a";
const b = "https://example.org/photos/b";
const c = "https://example.org/photos/c";
const d = "https://example.org/photos/d";
const members = Object.freeze([
  Object.freeze({ id: c, key: "k" }),
  Object.freeze({ id: a, key: "F" }),
  Object.freeze({ id: b, key: "V" }),
]);
const ids = (items: readonly AlbumMember[]) => items.map((item) => item.id);

describe("album membership and covers", () => {
  it("inserts into empty albums and before, between or after ordered members", () => {
    expect(addMember([], a)).toEqual([{ id: a, key: "V" }]);
    for (const [index, expected] of [
      [0, [d, a, b, c]],
      [1, [a, d, b, c]],
      [3, [a, b, c, d]],
    ] as const) {
      const result = addMember(members, d, index);
      expect(ids(result)).toEqual(expected);
      expect(result.map((member) => member.key)).toEqual(result.map((member) => member.key).sort());
      expect(result.filter((member) => member.id !== d)).toEqual([
        members[1],
        members[2],
        members[0],
      ]);
    }
    expect(ids(addMember(members, d))).toEqual([a, b, c, d]);
    expect(ids(members)).toEqual([c, a, b]);
  });

  it("removes members without changing remaining keys or the original", () => {
    expect(removeMember(members, b)).toEqual([members[1], members[0]]);
    expect(removeMember([{ id: a, key: "V" }], a)).toEqual([]);
    expect(ids(members)).toEqual([c, a, b]);
  });

  it.each([
    [a, 2, [b, c, a]],
    [c, 0, [c, a, b]],
    [a, 1, [b, a, c]],
    [c, 1, [a, c, b]],
  ] as const)("moves %s to final position %i", (id, index, expected) => {
    const result = reorderMember(members, id, index);
    expect(ids(result)).toEqual(expected);
    for (const member of members.filter((item) => item.id !== id)) {
      expect(result.find((item) => item.id === member.id)).toBe(member);
    }
    expect(result.map((member) => member.key)).toEqual(result.map((member) => member.key).sort());
  });

  it("preserves keys on a no-op move and returns a fresh array", () => {
    const result = reorderMember(members, b, 1);
    expect(result).toEqual([members[1], members[2], members[0]]);
    expect(result).not.toBe(members);
    expect(reorderMember([{ id: a, key: "V" }], a, 0)).toEqual([{ id: a, key: "V" }]);
  });

  it("chooses an explicit member or the first fractional key, and null when empty", () => {
    expect(selectCover(members)).toBe(a);
    expect(selectCover(members, null)).toBe(a);
    expect(selectCover(members, c)).toBe(c);
    expect(selectCover([])).toBeNull();
    expect(selectCover(reorderMember(members, c, 0))).toBe(c);
    expect(selectCover(removeMember(members, a))).toBe(b);
    expect(() => selectCover(removeMember(members, c), c)).toThrow(
      new AlbumError("member-not-found"),
    );
  });

  it.each([
    -1,
    4,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    null,
  ])("rejects invalid insertion position %s", (index) =>
    expect(() => addMember(members, d, index as number)).toThrow(
      new AlbumError("invalid-position"),
    ));
  it.each([-1, 3, 0.5, NaN, Infinity])("rejects invalid move position %s", (index) => {
    expect(() => reorderMember(members, b, index)).toThrow(new AlbumError("invalid-position"));
  });

  it("rejects duplicate additions, missing members and invalid identifiers", () => {
    expect(() => addMember(members, a)).toThrow(new AlbumError("duplicate-member"));
    for (const id of ["", "  ", null, 42]) {
      expect(() => addMember(members, id as string)).toThrow(new AlbumError("invalid-input"));
      expect(() => removeMember(members, id as string)).toThrow(new AlbumError("invalid-input"));
    }
    expect(() => removeMember(members, d)).toThrow(new AlbumError("member-not-found"));
    expect(() => reorderMember([], a, 0)).toThrow(new AlbumError("member-not-found"));
    expect(() => selectCover([], a)).toThrow(new AlbumError("member-not-found"));
  });

  it.each<[unknown, string]>([
    [null, "invalid-input"],
    [{}, "invalid-input"],
    [[null], "invalid-input"],
    [[{ id: "", key: "V" }], "invalid-input"],
    [
      [
        { id: a, key: "V" },
        { id: a, key: "k" },
      ],
      "duplicate-member",
    ],
    [
      [
        { id: a, key: "V" },
        { id: b, key: "V" },
      ],
      "invalid-order",
    ],
    ...[null, 3, "", "0", "A0", "a_b", "V\n", "é"].map((key): [unknown, string] => [
      [{ id: a, key }],
      "invalid-order",
    ]),
  ])("rejects malformed membership %j", (input, code) => {
    const album = input as readonly AlbumMember[];
    for (const operation of [
      () => addMember(album, d),
      () => removeMember(album, a),
      () => reorderMember(album, a, 0),
      () => selectCover(album),
    ]) {
      expect(operation).toThrow(AlbumError);
      expect(operation).toThrow(expect.objectContaining({ code, name: "AlbumError" }));
    }
  });

  it("supports repeated fractional inserts and moves without renumbering neighbours", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 100, maxLength: 200 }), (positions) => {
        let album: AlbumMember[] = [];
        const expected: string[] = [];
        positions.forEach((value, i) => {
          const index = value % (album.length + 1);
          const id = `https://example.org/photos/${i}`;
          const previous = album;
          album = addMember(album, id, index);
          expected.splice(index, 0, id);
          expect(ids(album)).toEqual(expected);
          expect(album.filter((member) => member.id !== id)).toEqual(previous);
        });
        positions.forEach((value) => {
          const from = value % album.length;
          const to = (from + 7) % album.length;
          const id = expected[from] as string;
          album = reorderMember(album, id, to);
          expected.splice(from, 1);
          expected.splice(to, 0, id);
          expect(ids(album)).toEqual(expected);
          const keys = album.map((member) => member.key);
          expect(keys).toEqual([...keys].sort());
          expect(new Set(keys).size).toBe(keys.length);
        });
      }),
      { seed: 20261026, numRuns: 10 },
    );
  });
});
