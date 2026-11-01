// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { classificationForType } from "../src/apps/home/lib/model/classify";
import type { DomainItem } from "../src/apps/home/lib/model/discovery";
import { DOMAINS, UNCATEGORISED } from "../src/apps/home/lib/model/domains";
import { CONNECTORS } from "../src/apps/home/lib/model/provenance";
import {
  APP_LINKS,
  cardView,
  connectedSources,
  connectorsForDomain,
  greeting,
  itemActions,
  itemTitle,
  parseTypes,
  relativeTime,
  sectionsFor,
  serializeTypes,
} from "../src/apps/home/state/presentation";

const { namedNode, literal, quad } = DataFactory;
const ROOT = "https://alice.demo.pod/";
const documents = DOMAINS.find((domain) => domain.id === "documents") as (typeof DOMAINS)[number];
function fixture(type = "notes", title = "A note", modified?: string, source?: string): DomainItem {
  const url = `${ROOT}${type}/${encodeURIComponent(title)}.ttl`;
  const subject = namedNode(`${url}#it`);
  return {
    ...classificationForType(type),
    url,
    subject,
    title,
    ...(modified === undefined ? {} : { modified }),
    containerUrl: new URL(".", url).href,
    etag: null,
    dataset: new Store(
      source ? [quad(subject, namedNode(`${NS.SCHEMA}url`), namedNode(source))] : [],
    ),
  };
}

describe("Home presentation", () => {
  it.each([
    [4, 59, "evening"],
    [5, 0, "morning"],
    [11, 59, "morning"],
    [12, 0, "afternoon"],
    [17, 59, "afternoon"],
    [18, 0, "evening"],
    [0, 0, "evening"],
  ])("greets at %i:%i", (hour, minute, period) => {
    expect(greeting(new Date(2026, 0, 1, Number(hour), Number(minute)), " Alice Wilder ")).toBe(
      `Good ${period}, Alice`,
    );
    expect(greeting(new Date(2026, 0, 1, Number(hour), Number(minute)), "  ")).toBe(
      `Good ${period}`,
    );
  });
  it("parses and serializes URL filters in taxonomy order, preserving an empty selection", () => {
    expect(parseTypes(null, documents)).toEqual(["files", "docs", "notes", "bookmarks"]);
    expect(parseTypes("notes,docs,docs,unknown", documents)).toEqual(["docs", "notes"]);
    expect(parseTypes("", documents)).toEqual([]);
    expect(serializeTypes(["notes", "docs", "unknown"], documents)).toBe("docs,notes");
    expect(serializeTypes([], documents)).toBe("");
    expect(serializeTypes(parseTypes(null, documents), documents)).toBeNull();
  });
  it("groups in table order, sorts by date then title, caps app sections and paginates other sections", () => {
    const items = [
      fixture("notes", "B"),
      fixture("notes", "A"),
      fixture("notes", "Newest", "2026-10-30"),
      fixture("docs", "A document"),
      fixture("identity", "Alice"),
      ...Array.from({ length: 8 }, (_, i) => fixture("files", `File ${i}`, `2026-10-${10 + i}`)),
    ];
    const sections = sectionsFor(documents, items, parseTypes(null, documents), 2);
    expect(sections.map((section) => section.label)).toEqual(["Files", "Documents", "Notes"]);
    expect(sections[0]?.app).toEqual({ href: "/drive", label: "Drive" });
    expect(sections[0]?.items.map((item) => item.title)).toEqual([
      "File 7",
      "File 6",
      "File 5",
      "File 4",
      "File 3",
      "File 2",
    ]);
    expect(sections[0]?.hasMore).toBe(false);
    expect(sections[1]?.app).toEqual({ href: "/docs", label: "Docs" });
    expect(sections[2]?.items.map((item) => item.title)).toEqual(["Newest", "A"]);
    expect(sections[2]?.hasMore).toBe(true);
    expect(
      sectionsFor(documents, items, ["notes"], 26)[0]?.items.map((item) => item.title),
    ).toEqual(["Newest", "A", "B"]);
    expect(sectionsFor(documents, [], [], 24)).toEqual([]);
    expect(APP_LINKS.tasks).toEqual({ label: "Tasks", href: "/tasks" });
    expect(APP_LINKS.calendar).toEqual({ label: "Calendar", href: "/calendar" });
    const other: DomainItem = { ...fixture(), domain: UNCATEGORISED };
    delete other.dataType;
    expect(sectionsFor(UNCATEGORISED, [other], [], 24)[0]?.label).toBe("Other");
    expect(sectionsFor(UNCATEGORISED, [], [], 24)).toEqual([]);
  });
  it("loads the next 24 cards across non-app sections", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => fixture("notes", `Note ${i}`)),
      ...Array.from({ length: 20 }, (_, i) => fixture("bookmarks", `Bookmark ${i}`)),
    ];
    const first = sectionsFor(documents, items, ["notes", "bookmarks"], 24);
    expect(first.map((section) => section.items.length)).toEqual([20, 4]);
    expect(first[1]?.hasMore).toBe(true);
    const more = sectionsFor(documents, items, ["notes", "bookmarks"], 48);
    expect(more.flatMap((section) => section.items)).toHaveLength(40);
    expect(more.some((section) => section.hasMore)).toBe(false);
  });
  it("joins available connector ids to domains and hides unknown domains", () => {
    for (const domain of DOMAINS) expect(connectorsForDomain(domain.id).length).toBeGreaterThan(0);
    expect(connectorsForDomain("media").map((source) => source.id)).toContain("spotify");
    expect(connectorsForDomain("other")).toEqual([]);
  });
  it("deduplicates connected sources, taking their newest timestamp, and caps at eight", () => {
    const early = fixture("music", "Older", "2026-10-28", "https://open.spotify.com/track/1");
    const latest = fixture("music", "Latest", "2026-10-30", "https://open.spotify.com/track/2");
    expect(connectedSources([early, latest, fixture()], ROOT)).toEqual([
      { id: "spotify", label: "Spotify", modified: "2026-10-30" },
    ]);
    const imported = { ...fixture("music"), containerUrl: `${ROOT}integrations/netflix/` };
    expect(connectedSources([imported], ROOT)).toEqual([{ id: "netflix", label: "Netflix" }]);
    const many = CONNECTORS.map((source) => ({
      ...fixture("music", source.id),
      containerUrl: `${ROOT}integrations/${source.id}/`,
    }));
    expect(connectedSources(many, ROOT)).toHaveLength(8);
  });
  it("formats relative dates without technical values", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    for (const [seconds, expected] of [
      [0, "just now"],
      [-20, "just now"],
      [60, "1 min ago"],
      [3600, "1 hour ago"],
      [7200, "2 hours ago"],
      [86400, "1 day ago"],
      [172800, "2 days ago"],
    ] as const)
      expect(relativeTime(new Date(now - seconds * 1000).toISOString(), now)).toBe(expected);
    expect(relativeTime("invalid", now)).toBe("time unknown");
  });
  it("keeps raw identifiers out of titles and card fields", () => {
    const item = fixture("notes", "A note");
    expect(itemTitle(item)).toBe("A note");
    expect(
      cardView(item, {
        types: [],
        properties: [],
        image: { src: `${ROOT}photo.png`, alt: "http://private.example" },
      }).image,
    ).toEqual({ src: `${ROOT}photo.png`, alt: "A note" });
    expect(itemTitle({ ...item, title: "https://example.org/private" })).toBe("A note.ttl");
    expect(itemTitle({ ...item, title: " " })).toBe("A note.ttl");
    expect(
      cardView(item, {
        types: ["type"],
        source: { label: "source", url: "https://example.org" },
        rawData: "private",
        properties: [
          { key: "website", label: "Website", values: ["https://example.org"] },
          { key: "description", label: "Description", values: ["Safe", "http://example.org"] },
          ...[1, 2, 3].map((n) => ({ key: `${n}`, label: "Detail", values: ["Safe"] })),
        ],
      }),
    ).toEqual({
      title: "A note",
      types: ["type"],
      properties: [
        { key: "description", label: "Description", values: ["Safe"] },
        { key: "1", label: "Detail", values: ["Safe"] },
        { key: "2", label: "Detail", values: ["Safe"] },
      ],
    });
  });
  it("shares the same safe action list between both menus", () => {
    const item = fixture("music", "Caroline", undefined, "https://open.spotify.com/track/caroline");
    const actions = itemActions(item, ROOT);
    expect(actions.map((action) => action.label)).toEqual([
      "Open",
      "Who can see this",
      "Open in Spotify",
      "Copy link",
    ]);
    expect(actions[1]?.href).toBe(`${actions[0]?.href}#access`);
    expect(actions[2]).toMatchObject({
      href: "https://open.spotify.com/track/caroline",
      external: true,
    });
    expect(itemActions(fixture(), ROOT).map((action) => action.id)).toEqual([
      "open",
      "access",
      "copy",
    ]);
    expect(
      itemActions(fixture("notes", "Same host", undefined, `${ROOT}source`), ROOT),
    ).toHaveLength(3);
    expect(
      itemActions(fixture("notes", "Unsafe", undefined, "javascript:alert(1)"), ROOT),
    ).toHaveLength(3);
    expect(
      itemActions(fixture("notes", "Other service", undefined, "https://example.org"), ROOT)[2]
        ?.label,
    ).toBe("Open in source");
    // A named source may contain several URL values; unsafe siblings cannot suppress a safe one.
    item.dataset.add(
      quad(
        namedNode(item.subject.value),
        namedNode(`${NS.SCHEMA}url`),
        literal("https://ignored.example"),
      ),
    );
    expect(itemActions(item, ROOT)).toEqual(actions);
  });
  it("labels source links from their selected destination despite conflicting URLs and container provenance", () => {
    const item = fixture("music", "Conflicting sources", undefined, "https://attacker.example/");
    item.containerUrl = `${ROOT}integrations/spotify/`;
    item.dataset.add(
      quad(
        namedNode(item.subject.value),
        namedNode(`${NS.SCHEMA}url`),
        namedNode("https://open.spotify.com/track/legitimate"),
      ),
    );
    expect(itemActions(item, ROOT).find((action) => action.id === "source")).toEqual({
      id: "source",
      label: "Open in source",
      href: "https://attacker.example/",
      external: true,
    });
    const youtube = fixture("music", "Different connector", undefined, "https://youtu.be/123");
    youtube.containerUrl = `${ROOT}integrations/spotify/`;
    youtube.dataset.add(
      quad(
        namedNode(youtube.subject.value),
        namedNode(`${NS.SCHEMA}url`),
        namedNode("https://spotify.com/track/1"),
      ),
    );
    expect(itemActions(youtube, ROOT).find((action) => action.id === "source")).toMatchObject({
      label: "Open in YouTube",
      href: "https://youtu.be/123",
    });
  });
});
