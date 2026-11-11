// AUTHORED-BY Codex GPT-6.1
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
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from "yjs";
import { buildDocument } from "../../apps/docs/lib/model/document";
import { docContainerUrls } from "../../apps/docs/lib/model/layout";
import { DEMO_ROOT } from "./constants";
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
/** A plain-text field value. */
type SeedField = readonly [predicate: string, value: string];
interface SeedEntry {
  path: string;
  type: string;
  name: string;
  fields: readonly SeedField[];
  source?: string;
}

/**
 * Separate resources match Home's primary-subject discovery contract. Contacts and
 * Calendar fixtures come from `seed-contacts.ts` and `seed-calendar.ts`, which Home
 * discovers through their Type Index registrations, so this seed does not duplicate them.
 */
export async function buildHomeSeed(now: number): Promise<DemoSeedFile[]> {
  const entries: SeedEntry[] = [
    ...[
      ["caroline", "Caroline", "Arlo Parks", "PT3M11S"],
      ["time", "Time (You and I)", "Khruangbin", "PT5M26S"],
      ["gorilla", "Gorilla", "Little Simz", "PT3M7S"],
    ].map(
      ([id, name, artist, duration]): SeedEntry => ({
        path: `integrations/spotify/${id}.ttl`,
        type: `${NS.SCHEMA}MusicRecording`,
        name: name as string,
        fields: [
          [`${NS.SCHEMA}byArtist`, artist as string],
          [`${NS.SCHEMA}duration`, duration as string],
        ],
        source: `https://open.spotify.com/track/${id}`,
      }),
    ),
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
  const companions: DemoSeedFile[] = [];
  const files = await Promise.all(
    entries.map(async (entry, index) => {
      const resource = new URL(entry.path, DEMO_ROOT).href;
      const subject = `${resource}#it`;
      const modified = now - (index + 1) * 60_000;
      const writer = new Writer({ format: "text/turtle" });
      if (entry.type === `${NS.POD_DOCS}Document`) {
        const layout = docContainerUrls(resource);
        const instanceId = crypto.randomUUID();
        const text = "A shared plan for the next chapter.";
        writer.addQuads([
          ...buildDocument(resource, {
            ...layout,
            instanceId,
            title: entry.name,
            body: text,
            format: "text/plain",
            now: new Date(modified),
          }),
        ]);
        // Writable Docs open from the durable CRDT log, never from the RDF snapshot.
        // Seed the same paragraph and incarnation that the editor will replay.
        const doc = new Doc();
        doc.getMap("document").set("instanceId", instanceId);
        const paragraph = new XmlElement("paragraph");
        const content = new XmlText();
        content.insert(0, text);
        paragraph.insert(0, [content]);
        doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
        for (const url of [layout.container, layout.updateLog, layout.assets, layout.comments]) {
          companions.push({
            path: url.slice(DEMO_ROOT.length),
            body: "",
            contentType: "text/turtle",
            modified,
          });
        }
        companions.push({
          path: `${layout.updateLog.slice(DEMO_ROOT.length)}seed.bin`,
          body: encodeStateAsUpdate(doc),
          contentType: "application/octet-stream",
          modified,
        });
        doc.destroy();
      } else {
        const store = new Store();
        const item = new SeedItem(subject, store, DataFactory);
        item.addType(entry.type);
        item.setText(`${NS.SCHEMA}name`, entry.name);
        item.modified = new Date(modified);
        for (const [predicate, value] of entry.fields) item.setText(predicate, value);
        if (entry.source) item.setIri(`${NS.SCHEMA}url`, entry.source);
        writer.addQuads([...store]);
      }
      const body = await new Promise<string>((resolve, reject) =>
        writer.end((error, value) => (error ? reject(error) : resolve(value))),
      );
      return { path: entry.path, body, contentType: "text/turtle", modified };
    }),
  );
  return [...files, ...companions];
}
