// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { PresentationData, SlideData } from "./generated/model.js";

export const THEMES = ["light", "dark", "contrast", "warm"] as const;
export const LAYOUTS = [
  "title",
  "title-and-body",
  "two-column",
  "section",
  "image",
  "blank",
] as const;
export type Theme = (typeof THEMES)[number];
export type Layout = (typeof LAYOUTS)[number];
export type Slide = SlideData & { id: string };
export type Deck = Omit<PresentationData, "slideUrls"> & { slides: Slide[] };

export function newSlide(id: string = crypto.randomUUID()): Slide {
  return {
    id,
    position: 0,
    layout: "title-and-body",
    title: "",
    body: "",
    notes: "",
    hidden: false,
  };
}
export function newDeck(name = "Untitled presentation", now = new Date()): Deck {
  return {
    name,
    theme: "light",
    aspectRatio: "16:9",
    created: now,
    modified: now,
    slides: [{ ...newSlide(), layout: "title", title: name }],
  };
}
const LINE_BREAK = /\r\n?/g;
function lf<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const result = { ...value };
  for (const key of keys) {
    const text = result[key];
    if (typeof text === "string") result[key] = text.replace(LINE_BREAK, "\n") as T[keyof T];
  }
  return result;
}
/** CRLF and CR become LF in every text field, so saved and exported decks round-trip. */
export function normaliseLineEndings(deck: Deck): Deck {
  return {
    ...lf(deck, ["name", "description"]),
    slides: deck.slides.map((slide) =>
      lf(slide, ["title", "body", "secondBody", "notes", "imageAlt"]),
    ),
  };
}
export function renumber(slides: readonly Slide[]): Slide[] {
  return slides.map((slide, position) => ({ ...slide, position }));
}
function indexIn(slides: readonly Slide[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= slides.length)
    throw new RangeError("Slide not found");
}
export function reorderSlides(slides: readonly Slide[], from: number, to: number): Slide[] {
  indexIn(slides, from);
  indexIn(slides, to);
  const result = [...slides];
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved as Slide);
  return renumber(result);
}
export function insertSlide(slides: readonly Slide[], at: number, slide = newSlide()): Slide[] {
  if (!Number.isInteger(at) || at < 0 || at > slides.length)
    throw new RangeError("Invalid slide position");
  if (slides.some((entry) => entry.id === slide.id))
    throw new TypeError("Slide identifiers must be unique");
  return renumber([...slides.slice(0, at), slide, ...slides.slice(at)]);
}
export function duplicateSlide(
  slides: readonly Slide[],
  index: number,
  id: string = crypto.randomUUID(),
): Slide[] {
  indexIn(slides, index);
  return insertSlide(slides, index + 1, { ...(slides[index] as Slide), id });
}
export function deleteSlide(slides: readonly Slide[], index: number): Slide[] {
  indexIn(slides, index);
  return renumber(slides.filter((_, position) => position !== index));
}
export function deckOutline(deck: Deck): string[] {
  return [...deck.slides]
    .sort((a, b) => a.position - b.position)
    .map((slide) => slide.title || "Untitled slide");
}
