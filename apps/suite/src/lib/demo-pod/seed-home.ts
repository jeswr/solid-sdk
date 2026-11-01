// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Writer } from "n3";
import type { DemoSeedFile } from "./pod";

const { namedNode, literal, quad } = DataFactory;

/** Separate resources match Home's primary-subject discovery contract. */
export async function buildHomeSeed(now: number): Promise<DemoSeedFile[]> {
  const entries = [
    {
      path: "contacts/bram.ttl",
      type: `${NS.VCARD}Individual`,
      name: "Bram Kerst",
      fields: [[`${NS.VCARD}hasEmail`, "bram@example.org"]],
    },
    {
      path: "contacts/ada.ttl",
      type: `${NS.VCARD}Individual`,
      name: "Ada Rivers",
      fields: [[`${NS.VCARD}hasEmail`, "ada@example.org"]],
    },
    {
      path: "calendar/coffee.ttl",
      type: `${NS.SCHEMA}Event`,
      name: "Coffee with Ada",
      fields: [
        [`${NS.SCHEMA}startDate`, new Date(now + 86_400_000).toISOString()],
        [`${NS.SCHEMA}location`, "The corner café"],
      ],
    },
    ...[
      ["caroline", "Caroline", "Arlo Parks", "PT3M11S"],
      ["time", "Time (You and I)", "Khruangbin", "PT5M26S"],
      ["gorilla", "Gorilla", "Little Simz", "PT3M7S"],
    ].map(([id, name, artist, duration]) => ({
      path: `integrations/spotify/${id}.ttl`,
      type: `${NS.SCHEMA}MusicRecording`,
      name: name as string,
      fields: [
        [`${NS.SCHEMA}byArtist`, artist as string],
        [`${NS.SCHEMA}duration`, duration as string],
      ],
      source: `https://open.spotify.com/track/${id}`,
    })),
    {
      path: "docs/launch.ttl",
      type: `${NS.POD_DOCS}Document`,
      name: "Launch plan",
      fields: [[`${NS.SCHEMA}description`, "A shared plan for the next chapter."]],
    },
    {
      path: "notes/weekend.ttl",
      type: `${NS.SCHEMA}TextDigitalDocument`,
      name: "Weekend ideas",
      fields: [[`${NS.SCHEMA}text`, "Walk by the river and visit the bookshop."]],
    },
    {
      path: "bookmarks/design.ttl",
      type: `${NS.BOOKMARK}Bookmark`,
      name: "Design inspiration",
      fields: [[`${NS.SCHEMA}description`, "Ideas saved for later."]],
    },
  ];
  return Promise.all(
    entries.map(async (entry, index) => {
      const subject = namedNode(`https://alice.demo.pod/${entry.path}#it`);
      const modified = now - (index + 1) * 60_000;
      const writer = new Writer({ format: "text/turtle" });
      writer.addQuads([
        quad(subject, namedNode(`${NS.RDF}type`), namedNode(entry.type)),
        quad(subject, namedNode(`${NS.SCHEMA}name`), literal(entry.name)),
        quad(
          subject,
          namedNode(`${NS.DCT}modified`),
          literal(new Date(modified).toISOString(), namedNode(`${NS.XSD}dateTime`)),
        ),
        ...entry.fields.map(([predicate, value]) =>
          quad(subject, namedNode(predicate as string), literal(value as string)),
        ),
        ...("source" in entry
          ? [quad(subject, namedNode(`${NS.SCHEMA}url`), namedNode(entry.source))]
          : []),
      ]);
      const body = await new Promise<string>((resolve, reject) =>
        writer.end((error, value) => (error ? reject(error) : resolve(value))),
      );
      return { path: entry.path, body, contentType: "text/turtle", modified };
    }),
  );
}
