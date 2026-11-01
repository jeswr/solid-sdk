// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { buildDocument } from "../../apps/docs/lib/model/document";
import type { DemoSeedFile } from "./pod";

/** A seed item written through wrapper accessors, never hand-built quads. */
class SeedItem extends TermWrapper {
  addType(value: string) {
    SetFrom.subjectPredicate(this, `${NS.RDF}type`, NamedNodeAs.string, NamedNodeFrom.string).add(
      value,
    );
  }
  setText(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  setIri(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  set modified(value: Date) {
    OptionalAs.object(this, `${NS.DCT}modified`, value, LiteralFrom.dateTime);
  }
}
/** A field value: plain text, or an IRI (vCard stores an email as a `mailto:` IRI). */
type SeedField = readonly [predicate: string, value: string, kind?: "iri"];

/** Separate resources match Home's primary-subject discovery contract. */
export async function buildHomeSeed(now: number): Promise<DemoSeedFile[]> {
  const entries = [
    {
      path: "contacts/bram.ttl",
      type: `${NS.VCARD}Individual`,
      name: "Bram Kerst",
      fields: [[`${NS.VCARD}hasEmail`, "mailto:bram@example.org", "iri"]] as SeedField[],
    },
    {
      path: "contacts/ada.ttl",
      type: `${NS.VCARD}Individual`,
      name: "Ada Rivers",
      fields: [[`${NS.VCARD}hasEmail`, "mailto:ada@example.org", "iri"]] as SeedField[],
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
      fields: [],
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
      const subject = `https://alice.demo.pod/${entry.path}#it`;
      const modified = now - (index + 1) * 60_000;
      const writer = new Writer({ format: "text/turtle" });
      if (entry.type === `${NS.POD_DOCS}Document`)
        writer.addQuads([
          ...buildDocument(subject.split("#")[0] as string, {
            title: entry.name,
            body: "A shared plan for the next chapter.",
            format: "text/plain",
            now: new Date(modified),
          }),
        ]);
      else {
        const store = new Store();
        const item = new SeedItem(subject, store, DataFactory);
        item.addType(entry.type);
        item.setText(`${NS.SCHEMA}name`, entry.name);
        item.modified = new Date(modified);
        for (const [predicate, value, kind] of entry.fields as readonly SeedField[])
          if (kind === "iri") item.setIri(predicate, value);
          else item.setText(predicate, value);
        if ("source" in entry) item.setIri(`${NS.SCHEMA}url`, entry.source);
        writer.addQuads([...store]);
      }
      const body = await new Promise<string>((resolve, reject) =>
        writer.end((error, value) => (error ? reject(error) : resolve(value))),
      );
      return { path: entry.path, body, contentType: "text/turtle", modified };
    }),
  );
}
