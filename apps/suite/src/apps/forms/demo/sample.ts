// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { DemoSnapshot } from "../lib/data/store";
import { newForm, newQuestion } from "../lib/designer";

/** Fictional people and events, exclusively for the in-browser demo. */
export function sampleForms(root: string): DemoSnapshot {
  const book = {
    ...newForm(new URL("forms/book-club.ttl#form", root).href),
    label: "Lantern Lane book club",
    description:
      "A cosy evening of stories. Tell us if you can join our fictional November gathering.",
    groups: [{ iri: new URL("forms/book-club.ttl#rsvp", root).href, label: "Your RSVP", order: 0 }],
    fields: [
      { ...newQuestion("name"), label: "Your name", minCount: 1, minLength: 2, maxLength: 80 },
      { ...newQuestion("attending", "boolean"), label: "Can you join us?", minCount: 1 },
      {
        ...newQuestion("book", "choice"),
        label: "Which book shall we read?",
        minCount: 1,
        options: ["The Clockwork Orchard", "Letters from the Moon", "A Map of Small Wonders"].map(
          (value) => ({ value, termType: "Literal" as const }),
        ),
      },
      {
        ...newQuestion("notes", "multiline"),
        label: "Anything else?",
        description: "Dietary needs, access requirements or a favourite biscuit.",
        maxLength: 500,
      },
    ].map((field, order) => ({
      ...field,
      order,
      group: new URL("forms/book-club.ttl#rsvp", root).href,
    })),
  };
  const feedback = {
    ...newForm(new URL("forms/feedback.ttl#form", root).href),
    label: "Neighbourhood workshop feedback",
    description: "Help our fictional craft workshop get even better. This takes about a minute.",
    fields: [
      {
        ...newQuestion("rating", "integer"),
        label: "How was the workshop?",
        description: "Choose a score from 1 to 5.",
        minCount: 1,
        minInclusive: 1,
        maxInclusive: 5,
      },
      { ...newQuestion("favourite", "multiline"), label: "What worked well?", maxLength: 1000 },
      { ...newQuestion("return", "boolean"), label: "Would you come again?" },
    ],
  };
  return {
    version: 1,
    forms: [book, feedback],
    responses: [
      {
        subject: "https://mira.example/forms/responses/rsvp.ttl#response",
        form: book.shape,
        values: {
          q_name: "Mira Fern",
          q_attending: true,
          q_book: "A Map of Small Wonders",
          q_notes: "I can bring oat biscuits.",
        },
      },
      {
        subject: "https://otto.example/forms/responses/rsvp.ttl#response",
        form: book.shape,
        values: { q_name: "Otto Reed", q_attending: false, q_book: "Letters from the Moon" },
      },
      {
        subject: "https://linden.example/forms/responses/feedback.ttl#response",
        form: feedback.shape,
        values: { q_rating: 5, q_favourite: "The patient, friendly teaching.", q_return: true },
      },
    ],
  };
}
