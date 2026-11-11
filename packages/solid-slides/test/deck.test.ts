// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  deckOutline,
  deleteSlide,
  duplicateSlide,
  insertSlide,
  newDeck,
  newSlide,
  renumber,
  reorderSlides,
} from "../src/deck.js";

const slides = () =>
  [newSlide("a"), newSlide("b"), newSlide("c")].map((slide, position) => ({
    ...slide,
    position,
    title: position === 1 ? "" : slide.id,
  }));
describe("slide operations", () => {
  it("creates independent decks and defaults", () => {
    const deck = newDeck();
    expect(deck.name).toBe("Untitled presentation");
    expect(deck.slides[0]?.layout).toBe("title");
    expect(newDeck().slides[0]?.id).not.toBe(deck.slides[0]?.id);
    expect(newSlide().hidden).toBe(false);
    expect(newDeck("A", new Date(0)).created).toEqual(new Date(0));
  });
  it("renumbers without mutating, moves both ways and extracts a sorted outline", () => {
    const original = slides();
    expect(reorderSlides(original, 0, 2).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(reorderSlides(original, 2, 0).map((s) => s.position)).toEqual([0, 1, 2]);
    expect(original[0]?.id).toBe("a");
    expect(reorderSlides(original, 1, 1)).toEqual(original);
    expect(renumber([])).toEqual([]);
    expect(deckOutline({ ...newDeck(), slides: [...original].reverse() })).toEqual([
      "a",
      "Untitled slide",
      "c",
    ]);
  });
  it("inserts, duplicates and deletes at every edge", () => {
    expect(insertSlide([], 0, newSlide("first"))[0]?.id).toBe("first");
    expect(insertSlide(slides(), 3)).toHaveLength(4);
    expect(insertSlide(slides(), 1, newSlide("extra"))[1]?.id).toBe("extra");
    expect(duplicateSlide(slides(), 1, "copy")[2]).toMatchObject({ id: "copy", position: 2 });
    expect(duplicateSlide(slides(), 0)).toHaveLength(4);
    expect(deleteSlide(slides(), 1).map((s) => s.position)).toEqual([0, 1]);
    expect(deleteSlide([newSlide()], 0)).toEqual([]);
  });
  it.each([-1, 3, 1.2, NaN])("rejects invalid source indexes %s", (index) => {
    expect(() => reorderSlides(slides(), index, 0)).toThrow(RangeError);
    expect(() => reorderSlides(slides(), 0, index)).toThrow(RangeError);
    expect(() => deleteSlide(slides(), index)).toThrow(RangeError);
    expect(() => duplicateSlide(slides(), index)).toThrow(RangeError);
  });
  it.each([-1, 4, 0.5, NaN])("rejects invalid insert indexes %s", (index) =>
    expect(() => insertSlide(slides(), index)).toThrow(RangeError));
  it("rejects reused identifiers", () => {
    expect(() => insertSlide(slides(), 0, newSlide("a"))).toThrow(TypeError);
    expect(() => duplicateSlide(slides(), 0, "b")).toThrow(TypeError);
  });
});
