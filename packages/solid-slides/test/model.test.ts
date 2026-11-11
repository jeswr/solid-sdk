// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { newDeck, newSlide } from "../src/deck.js";
import { buildDeck, entities, parseDeck, parseDeckDocument, serializeDeck } from "../src/model.js";

const url = "https://pod.example/slides/deck.ttl";
describe("generated presentation facade", () => {
  it("round-trips every field in one document, safely escaping literals", async () => {
    const deck = {
      ...newDeck("A <story>"),
      description: "Description",
      theme: "contrast" as const,
      aspectRatio: "4:3" as const,
      slides: [
        {
          ...newSlide("one space"),
          title: '"quoted"',
          body: "**Markdown**\n---",
          secondBody: "Other",
          notes: "Private",
          image: "https://pod.example/image.png",
          imageAlt: "A moon",
          drawing: "https://pod.example/drawing.ttl#scene",
          hidden: true,
        },
      ],
    };
    const ttl = await serializeDeck(url, deck);
    expect(await parseDeckDocument(url, ttl)).toEqual(deck);
    expect(ttl).toContain("PresentationDigitalDocument");
    expect(ttl).toContain("hasPart");
    const empty = { ...deck, slides: [] };
    expect(parseDeck(url, buildDeck(url, empty))).toEqual(empty);
  });
  it("orders by position with stable identifier ties and rejects missing children", () => {
    const deck = {
      ...newDeck(),
      slides: [
        { ...newSlide("z"), position: 1 },
        { ...newSlide("b"), position: 0 },
        { ...newSlide("a"), position: 0 },
      ],
    };
    expect(parseDeck(url, buildDeck(url, deck))?.slides.map((slide) => slide.id)).toEqual([
      "a",
      "b",
      "z",
    ]);
    expect(parseDeck(url, new Store())).toBeUndefined();
    const missing = entities.Presentation.build(url, {
      ...newDeck(),
      slideUrls: [`${url}#slide-gone`],
    });
    expect(parseDeck(url, missing)).toBeUndefined();
  });
  it("rejects foreign children and broken fragment encoding", () => {
    for (const child of ["https://evil.example/child", `${url}#slide-%ZZ`]) {
      const store = entities.Presentation.build(url, { ...newDeck(), slideUrls: [child] });
      store.addQuads([...entities.Slide.build(child, newSlide())]);
      expect(parseDeck(url, store)).toBeUndefined();
    }
  });
  it("fails closed on required values, unsafe subjects and duplicate IDs", async () => {
    expect(() => buildDeck("relative", newDeck())).toThrow();
    expect(() => buildDeck(url, { ...newDeck(), theme: "neon" as never })).toThrow(
      "Invalid presentation",
    );
    expect(() =>
      buildDeck(url, { ...newDeck(), slides: [{ ...newSlide(), position: -1 }] }),
    ).toThrow("Invalid slide");
    expect(() => buildDeck(url, { ...newDeck(), slides: [newSlide("a"), newSlide("a")] })).toThrow(
      "unique",
    );
    const data = await parseRdf(
      "<https://pod.example/slides/deck.ttl#it> a <http://schema.org/PresentationDigitalDocument>.",
      "text/turtle",
    );
    expect(parseDeck(url, data)).toBeUndefined();
    await expect(parseDeckDocument(url, "not Turtle")).rejects.toThrow();
  });
});
it("rejects distinct hash spellings that decode to the same slide identifier", () => {
  const one = `${url}#slide-a`;
  const two = `${url}#slide-%61`;
  const dataset = entities.Presentation.build(url, { ...newDeck(), slideUrls: [one, two] });
  dataset.addQuads([
    ...entities.Slide.build(one, newSlide("a")),
    ...entities.Slide.build(two, newSlide("other")),
  ]);
  expect(parseDeck(url, dataset)).toBeUndefined();
});
