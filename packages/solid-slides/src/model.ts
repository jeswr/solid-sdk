// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type DatasetCore, parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { Store } from "n3";
import type { Deck, Slide } from "./deck.js";
import { entities } from "./generated/model.js";

export { entities } from "./generated/model.js";
export const PRESENTATION_CLASS = "http://schema.org/PresentationDigitalDocument";

/** Repeated children cannot be composite projections. Each is still a generated entity. */
export function buildDeck(resource: string, deck: Deck): Store {
  const urls = deck.slides.map((slide) => `${resource}#slide-${encodeURIComponent(slide.id)}`);
  if (new Set(urls).size !== urls.length) throw new TypeError("Slide identifiers must be unique");
  const store = entities.Presentation.build(resource, { ...deck, slideUrls: urls });
  deck.slides.forEach((slide, index) => {
    const child = entities.Slide.build(urls[index] as string, slide);
    if (!entities.Slide.parse(urls[index] as string, child)) throw new TypeError("Invalid slide");
    store.addQuads([...child]);
  });
  if (!parseDeck(resource, store)) throw new TypeError("Invalid presentation");
  return store;
}
export function parseDeck(resource: string, dataset: DatasetCore): Deck | undefined {
  const presentation = entities.Presentation.parse(resource, dataset);
  if (!presentation) return undefined;
  const { slideUrls = [], ...fields } = presentation;
  const slides: Slide[] = [];
  for (const url of slideUrls) {
    if (!url.startsWith(`${resource}#slide-`)) return undefined;
    const slide = entities.Slide.parse(url, dataset);
    if (!slide) return undefined;
    try {
      slides.push({ ...slide, id: decodeURIComponent(url.slice(`${resource}#slide-`.length)) });
    } catch {
      return undefined;
    }
  }
  slides.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (new Set(slides.map((slide) => slide.id)).size !== slides.length) return undefined;
  return { ...fields, slides };
}
export async function serializeDeck(resource: string, deck: Deck): Promise<string> {
  return serialize([...buildDeck(resource, deck)]);
}
export async function parseDeckDocument(
  resource: string,
  body: string,
  contentType = "text/turtle",
) {
  return parseDeck(resource, await parseRdf(body, contentType, { baseIRI: resource }));
}
