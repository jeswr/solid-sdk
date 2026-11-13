// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  createSequenceMatcher,
  isEditableTarget,
  parseKeys,
  type ShortcutEvent,
} from "../src/shell/lib/shortcuts";

const event = (key: string, rest: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  meta: false,
  ctrl: false,
  alt: false,
  shift: false,
  editable: false,
  now: 0,
  ...rest,
});
describe("shortcut registration", () => {
  it("parses sequences and platform and literal modifiers", () => {
    expect(parseKeys("  g  d ").map((stroke) => stroke.key)).toEqual(["g", "d"]);
    expect(parseKeys("Cmd/Ctrl+Shift+F")[0]).toEqual({
      key: "f",
      cmd: true,
      meta: false,
      ctrl: false,
      alt: false,
      shift: true,
    });
    expect(parseKeys("Cmd+K")[0]?.cmd).toBe(true);
    expect(parseKeys("Meta+Alt+K")[0]).toMatchObject({ meta: true, alt: true });
    expect(parseKeys("Ctrl+K")[0]?.ctrl).toBe(true);
  });
  it.each(["", "  ", "Ctrl+", "Super+K", "g Ctrl+"])("rejects invalid registration %j", (keys) =>
    expect(() => parseKeys(keys)).toThrow());
  it.each(
    ["Cmd", "Cmd/Ctrl", "Meta", "Ctrl"].flatMap((modifier) =>
      ["T", "W", "N", "L", "R"].map((key) => `${modifier}+${key}`),
    ),
  )("rejects browser shortcut %s", (keys) =>
    expect(() => createSequenceMatcher([{ id: "browser", keys }])).toThrow("Browser shortcuts"));
  it("rejects browser shortcuts inside sequences, including shifted ones", () =>
    expect(() => parseKeys("g Ctrl+Shift+R")).toThrow());
});
describe("editable targets", () => {
  it("handles missing targets, non-elements and text-node targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(new EventTarget())).toBe(false);
    expect(isEditableTarget({ parentElement: null } as unknown as EventTarget)).toBe(false);
    const closest = vi.fn().mockReturnValue({});
    const element = { closest } as unknown as EventTarget;
    expect(isEditableTarget(element)).toBe(true);
    expect(isEditableTarget({ parentElement: element } as unknown as EventTarget)).toBe(true);
    expect(closest).toHaveBeenCalledWith(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [data-shortcuts="off"]',
    );
    closest.mockReturnValue(null);
    expect(isEditableTarget(element)).toBe(false);
  });
});
describe("sequence matcher", () => {
  it("matches single keys, sequences and resets after a match", () => {
    const matcher = createSequenceMatcher([
      { id: "drive", keys: "g d" },
      { id: "search", keys: "/" },
    ]);
    expect(matcher.feed(event("/"))).toEqual({ matched: "search", pending: false });
    expect(matcher.feed(event("g"))).toEqual({ pending: true });
    expect(matcher.feed(event("d", { now: 999 }))).toEqual({ matched: "drive", pending: false });
    expect(matcher.feed(event("d", { now: 1000 }))).toEqual({ pending: false });
    expect(matcher.feed(event("g", { now: 1100 }))).toEqual({ pending: true });
    matcher.reset();
    expect(matcher.feed(event("d", { now: 1101 }))).toEqual({ pending: false });
  });
  it("handles shared prefixes and arbitrary-length sequences", () => {
    const matcher = createSequenceMatcher([
      { id: "drive", keys: "g d" },
      { id: "deep", keys: "g o t" },
    ]);
    expect(matcher.feed(event("g"))).toEqual({ pending: true });
    expect(matcher.feed(event("o"))).toEqual({ pending: true });
    expect(matcher.feed(event("t"))).toEqual({ matched: "deep", pending: false });
  });
  it("resets on unknown keys, exact timeout boundaries, backwards clocks and explicit reset", () => {
    const matcher = createSequenceMatcher([{ id: "drive", keys: "g d" }], { timeoutMs: 50 });
    matcher.feed(event("g"));
    expect(matcher.feed(event("x", { now: 1 }))).toEqual({ pending: false });
    expect(matcher.feed(event("d", { now: 2 }))).toEqual({ pending: false });
    matcher.feed(event("g", { now: 10 }));
    expect(matcher.feed(event("d", { now: 60 }))).toEqual({ pending: false });
    matcher.feed(event("g", { now: 100 }));
    expect(matcher.feed(event("d", { now: 99 }))).toEqual({ pending: false });
    matcher.feed(event("g", { now: 200 }));
    expect(matcher.feed(event("g", { now: 251 }))).toEqual({ pending: true });
    expect(matcher.feed(event("d", { now: 252 }))).toEqual({ matched: "drive", pending: false });
  });
  it("suppresses single keys, shift keys, help and sequences while editing, even mid-sequence", () => {
    const matcher = createSequenceMatcher([
      { id: "drive", keys: "g d" },
      { id: "theme", keys: "Shift+D" },
      { id: "help", keys: "?" },
      { id: "search", keys: "/" },
    ]);
    for (const key of ["g", "d", "/", "?"])
      expect(matcher.feed(event(key, { editable: true }))).toEqual({ pending: false });
    expect(matcher.feed(event("D", { editable: true, shift: true }))).toEqual({ pending: false });
    matcher.feed(event("g"));
    expect(matcher.feed(event("d", { editable: true }))).toEqual({ pending: false });
    expect(matcher.feed(event("d"))).toEqual({ pending: false });
  });
  it.each([
    "MacIntel",
    "iPhone",
    "iPad",
    "Linux",
    "Win32",
    "",
  ])("resolves Cmd for %s and permits modifiers in editable fields", (platform) => {
    const matcher = createSequenceMatcher(
      [
        { id: "palette", keys: "Cmd+K" },
        { id: "scope", keys: "Cmd/Ctrl+Shift+F" },
      ],
      { platform },
    );
    const primary = /mac|iphone|ipad/i.test(platform) ? { meta: true } : { ctrl: true };
    expect(matcher.feed(event("k", { ...primary, editable: true }))).toEqual({
      matched: "palette",
      pending: false,
    });
    expect(matcher.feed(event("F", { ...primary, shift: true, editable: true }))).toEqual({
      matched: "scope",
      pending: false,
    });
    expect(matcher.feed(event("k", { meta: true, ctrl: true }))).toEqual({ pending: false });
    expect(matcher.feed(event("k"))).toEqual({ pending: false });
  });
  it("requires exact modifiers, except Shift on a question-mark event", () => {
    const matcher = createSequenceMatcher([
      { id: "theme", keys: "Shift+D" },
      { id: "help", keys: "?" },
      { id: "alt", keys: "Alt+K" },
      { id: "control", keys: "Ctrl+K" },
      { id: "meta", keys: "Meta+K" },
    ]);
    expect(matcher.feed(event("D", { shift: true }))).toEqual({ matched: "theme", pending: false });
    expect(matcher.feed(event("d"))).toEqual({ pending: false });
    expect(matcher.feed(event("?", { shift: true }))).toEqual({ matched: "help", pending: false });
    expect(matcher.feed(event("?"))).toEqual({ matched: "help", pending: false });
    expect(matcher.feed(event("/", { shift: true }))).toEqual({ pending: false });
    expect(matcher.feed(event("k", { alt: true }))).toEqual({ matched: "alt", pending: false });
    expect(matcher.feed(event("k", { alt: true, shift: true }))).toEqual({ pending: false });
    expect(matcher.feed(event("k", { ctrl: true, editable: true }))).toEqual({
      matched: "control",
      pending: false,
    });
    expect(matcher.feed(event("k", { meta: true, editable: true }))).toEqual({
      matched: "meta",
      pending: false,
    });
  });
  it("prefers narrower scopes and later registrations within a scope", () => {
    const bindings = [
      { id: "first", keys: "g d" },
      { id: "second", keys: "g d", scope: "global" as const },
      { id: "app", keys: "g d", scope: "app" as const },
      { id: "editor", keys: "g d", scope: "editor" as const },
    ];
    for (let length = 1; length <= bindings.length; length++) {
      const matcher = createSequenceMatcher(bindings.slice(0, length));
      matcher.feed(event("g"));
      expect(matcher.feed(event("d"))).toEqual({
        matched: bindings[length - 1]?.id,
        pending: false,
      });
    }
  });
  it("handles an empty registry", () =>
    expect(createSequenceMatcher([]).feed(event("g"))).toEqual({ pending: false }));
  it("lets primary-modifier commands interrupt a pending sequence", () => {
    for (const platform of ["MacIntel", "Linux"]) {
      const matcher = createSequenceMatcher(
        [
          { id: "drive", keys: "g d" },
          { id: "palette", keys: "Cmd/Ctrl+K" },
        ],
        { platform },
      );
      expect(matcher.feed(event("g"))).toEqual({ pending: true });
      expect(
        matcher.feed(
          event("k", { editable: true, meta: platform === "MacIntel", ctrl: platform === "Linux" }),
        ),
      ).toEqual({ matched: "palette", pending: false });
    }
  });
  it("also supports sequences containing modifier strokes", () => {
    const matcher = createSequenceMatcher([{ id: "sequence", keys: "g Ctrl+K Ctrl+F" }]);
    expect(matcher.feed(event("g"))).toEqual({ pending: true });
    expect(matcher.feed(event("k", { ctrl: true, editable: true }))).toEqual({ pending: true });
    expect(matcher.feed(event("f", { ctrl: true, editable: true }))).toEqual({
      matched: "sequence",
      pending: false,
    });
  });
});
