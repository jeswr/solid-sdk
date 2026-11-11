// AUTHORED-BY Codex (GPT-6.1 Sol)
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { type Deck, newDeck, newSlide, type Slide } from "./deck.js";
import { buildDeck, parseDeck } from "./model.js";

/** An inert preview: no images, inline styles or executable URLs. */
export function renderSlideMarkdown(text: string): string {
  return sanitizeHtml(marked.parse(text, { async: false, gfm: true }), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "hr",
      "a",
    ],
    allowedAttributes: { a: ["href", "title", "rel"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
  });
}
const META = "<!-- solid-slides ";
const VALIDATION_URL = "https://slides.example/validation.ttl";
/** Serialisable drafts are validated through generated entities, with explicit Date revival. */
export function decodeDeck(value: string): Deck {
  const data = JSON.parse(value);
  const candidate = { ...data, created: new Date(data.created), modified: new Date(data.modified) };
  const result = parseDeck(VALIDATION_URL, buildDeck(VALIDATION_URL, candidate));
  if (!result) throw new TypeError("Invalid presentation");
  return result;
}
/** Conventional Markdown has no front matter. Only a line exactly --- splits slides. */
export function deckFromMarkdown(markdown: string, now = new Date()): Deck {
  const chunks = markdown.replace(/\r\n?/g, "\n").split(/^---$/m);
  const deck = newDeck("Untitled presentation", now);
  deck.slides = chunks.map((chunk, index) => {
    const cleanChunk = chunk.replace(/^\n/, "").replace(/\n$/, "");
    let lines = cleanChunk.split("\n");
    let metadata: Partial<Slide> = {};
    let exported = false;
    const metaLine = lines[0];
    if (metaLine?.startsWith(META) && metaLine.endsWith(" -->")) {
      try {
        const parsed = JSON.parse(decodeURIComponent(metaLine.slice(META.length, -4)));
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.slide &&
          typeof parsed.slide === "object"
        ) {
          metadata = parsed.slide;
          if (index === 0 && parsed.deck) {
            const d = parsed.deck;
            Object.assign(deck, {
              name: d.name,
              description: d.description,
              theme: d.theme,
              aspectRatio: d.aspectRatio,
              created: new Date(d.created),
              modified: new Date(d.modified),
            });
          }
          lines = (index === 0 ? chunk : chunk.replace(/^\n/, "")).split("\n").slice(1);
          if (index < chunks.length - 1) lines.pop();
          exported = true;
        }
      } catch {
        /* An invalid comment remains ordinary Markdown. */
      }
    }
    const titleAt = lines.findIndex((line) => /^# /.test(line));
    const title = titleAt < 0 ? "" : (lines.splice(titleAt, 1)[0] as string).slice(2);
    const notesAt = lines.findIndex((line) => line === "???" || /^Note:(?: |$)/.test(line));
    const bodyLines = notesAt < 0 ? lines : lines.slice(0, notesAt);
    const noteLines =
      notesAt < 0
        ? []
        : [lines[notesAt]?.replace(/^(?:\?\?\?|Note: ?)/, "") ?? "", ...lines.slice(notesAt + 1)];
    const restore = (text: string) =>
      exported ? text.replace(/^\\(?=---$|\?\?\?$|Note:|# |\\)/gm, "") : text;
    return {
      ...newSlide(`slide-${index + 1}`),
      ...metadata,
      position: index,
      layout: metadata.layout ?? (index === 0 ? "title" : "title-and-body"),
      title: restore(title),
      body: restore(
        bodyLines
          .join("\n")
          .replace(/^\n/, "")
          .replace(exported ? /\n$/ : /\n+$/, ""),
      ),
      notes: restore(noteLines.join("\n").replace(/^\n/, "")),
    };
  });
  if (!markdown.startsWith(META)) deck.name = deck.slides[0]?.title || deck.name;
  return decodeDeck(JSON.stringify(deck));
}
export function deckToMarkdown(deck: Deck): string {
  if (!deck.slides.length) throw new TypeError("Add a slide before exporting Markdown");
  const protect = (text: string) => text.replace(/^(?=---$|\?\?\?$|Note:|# |\\)/gm, "\\");
  const { slides, ...fields } = deck;
  return slides
    .map((slide, index) => {
      const { title = "", body = "", notes = "", ...rest } = slide;
      const metadata = encodeURIComponent(
        JSON.stringify({ slide: rest, ...(index === 0 ? { deck: fields } : {}) }),
      );
      return `${META}${metadata} -->\n# ${protect(title)}\n\n${protect(body)}\n\n???\n${protect(notes)}`;
    })
    .join("\n---\n");
}
