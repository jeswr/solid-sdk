// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it } from "vitest";
import {
  type DomainItem,
  discoverDomainItems,
  nameFromUrl,
  sortItems,
} from "../../src/apps/home/lib/model/discovery";
import { DOMAINS } from "../../src/apps/home/lib/model/domains";
import { provenanceOf } from "../../src/apps/home/lib/model/provenance";
import { fixtureFetch, rdf, STORAGE, WEB_ID } from "./fixtures";

describe("domain discovery", () => {
  it("retains the containing folder of direct instances after integration URL deduplication", async () => {
    const url = `${STORAGE}integrations/netflix/watched.ttl`;
    const containerUrl = `${STORAGE}integrations/netflix/`;
    const fetch = fixtureFetch({
      [url]: '<#it> a schema:Movie ; schema:name "A film" .',
      [`${STORAGE}integrations/`]: "<> ldp:contains <netflix/> .",
      [containerUrl]: "<> ldp:contains <watched.ttl> .",
    });
    const result = await discoverDomainItems("media", {
      storage: STORAGE,
      fetch,
      typeIndex: [{ forClass: `${NS.SCHEMA}Movie`, instance: `${url}#it` }],
    });
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(1);
    const item = result.items[0] as DomainItem;
    expect(item.containerUrl).toBe(containerUrl);
    expect(
      provenanceOf(item.dataset, item.subject, item.containerUrl, { storage: STORAGE }),
    ).toEqual({
      kind: "source",
      label: "Netflix",
      logoId: "netflix",
    });
    expect(fetch.mock.calls.filter(([input]) => String(input) === url)).toHaveLength(1);
  });

  it.each([
    NS.CAL,
    "http://www.w3.org/2002/12/cal/icaltzd#",
  ])("reads task titles from %ssummary, including Pod Manager task output", async (ical) => {
    const url = `${STORAGE}tasks/generated-id.ttl`;
    // Pod Manager buildTask writes #it, Vtodo, summary and NEEDS-ACTION status.
    const fetch = fixtureFetch({
      [url]: `<#it> a <${ical}Vtodo> ; <${ical}summary> "Buy groceries" ; <${ical}status> "NEEDS-ACTION" .`,
    });
    const result = await discoverDomainItems("calendar", {
      storage: STORAGE,
      fetch,
      typeIndex: [{ forClass: `${ical}Vtodo`, instance: url }],
    });
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ title: "Buy groceries", dataType: { id: "tasks" } });
  });

  it("merges public/private locations and known folders, deduplicating and classifying actual primary subjects", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}registered/`]:
        '<> ldp:contains <one.ttl>, <two.ttl>, <ignored-folder/> . <ignored-folder/> a ldp:BasicContainer . <one.ttl> dct:modified "2025-01-01" .',
      [`${STORAGE}registered/one.ttl`]:
        '<#it> a schema:Book ; schema:name "Registered" ; dct:modified "2026-01-02" . <#another> a schema:Event .',
      [`${STORAGE}registered/two.ttl`]: '<#this> a schema:Book ; schema:name "Earlier" .',
      [`${STORAGE}integrations/`]:
        "<> a ldp:BasicContainer ; ldp:contains <spotify/>, <self/> . <spotify/> a ldp:Container .",
      [`${STORAGE}integrations/spotify/`]:
        '<> ldp:contains <songs.ttl>, <nested/> . <songs.ttl> dct:modified "2026-01-01" .',
      [`${STORAGE}integrations/spotify/nested/`]:
        "<> a ldp:Container ; ldp:contains <../>, <more.ttl> .",
      [`${STORAGE}integrations/spotify/songs.ttl`]:
        '<#it> a old:MusicRecording ; old:name "Song" .',
      [`${STORAGE}integrations/spotify/nested/more.ttl`]: "<#this> a schema:MusicPlaylist .",
      [`${STORAGE}media/books/`]: "<> ldp:contains <one.ttl> .",
      [`${STORAGE}media/books/one.ttl`]:
        '<#it> a schema:Book ; schema:name "Known" ; dct:modified "2026-02-01" .',
      [`${STORAGE}not-media.ttl`]: "<#it> a schema:Event .",
    });
    const result = await discoverDomainItems("media", {
      storage: STORAGE,
      fetch,
      typeIndex: [
        { forClass: `${NS.SCHEMA}Book`, container: `${STORAGE}registered/` },
        { forClass: `${NS.SCHEMA}MusicRecording`, container: `${STORAGE}registered/` },
        { forClass: `${NS.SCHEMA}Book`, instance: `${STORAGE}registered/one.ttl#it` },
        { forClass: `${NS.SCHEMA}Book`, instance: `${STORAGE}not-media.ttl` },
        { forClass: `${NS.SCHEMA}Event`, instance: `${STORAGE}unrelated.ttl` },
      ],
    });
    expect(result.items.map((item) => item.title)).toEqual([
      "Known",
      "Registered",
      "Song",
      "Earlier",
      "more.ttl",
    ]);
    expect(result.items.map((item) => item.dataType?.id)).toEqual([
      "books",
      "books",
      "music",
      "books",
      "music",
    ]);
    expect(result.items[1]?.subject.value).toBe(`${STORAGE}registered/one.ttl#it`);
    expect(result.failures).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.etags.get(`${STORAGE}registered/`)).toBe('"/alice/registered/"');
    expect(result.items[0]?.etag).toBe('"/alice/media/books/one.ttl"');
    expect(
      fetch.mock.calls.filter(([input]) => String(input) === `${STORAGE}registered/one.ttl`),
    ).toHaveLength(1);
    expect(fetch.mock.calls.some(([input]) => String(input).includes("ignored-folder"))).toBe(
      false,
    );
    expect(fetch.mock.calls.some(([input]) => String(input).includes("unrelated"))).toBe(false);
  });

  it("uses only the primary subject for connector collections independently of the WebID", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}collection.ttl`]:
        '<#a> a schema:MusicRecording ; schema:name "A" . <#b> a schema:MusicRecording . <#c> a schema:MusicRecording .',
    });
    const result = await discoverDomainItems("media", {
      storage: STORAGE,
      fetch,
      webId: WEB_ID,
      typeIndex: [{ forClass: `${NS.SCHEMA}MusicRecording`, instance: `${STORAGE}collection.ttl` }],
    });
    expect(result.items.map((item) => item.title)).toEqual(["A"]);
  });

  it.each([
    true,
    false,
  ])("merges listing dates into directly registered items (instance first: %s)", async (instanceFirst) => {
    const container = `${STORAGE}registered/`;
    const url = `${container}one.ttl`;
    const fetch = fixtureFetch({
      [container]: `<> ldp:contains <one.ttl#it>, <two.ttl> .
          <one.ttl#it> dct:modified "2026-02-01" .
          <two.ttl> dct:modified "2026-03-01" .`,
      [url]: '<#it> a schema:Book ; schema:name "Z" .',
      [`${container}two.ttl`]:
        '<#it> a schema:Book ; schema:name "A" ; dct:modified "2026-01-01" .',
    });
    const registrations = [
      { forClass: `${NS.SCHEMA}Book`, instance: `${url}#it` },
      { forClass: `${NS.SCHEMA}Book`, container },
    ];
    const result = await discoverDomainItems("media", {
      storage: STORAGE,
      fetch,
      typeIndex: instanceFirst ? registrations : registrations.reverse(),
    });
    expect(result.failures).toEqual([]);
    expect(result.items.map((item) => [item.title, item.modified])).toEqual([
      ["Z", "2026-02-01"],
      ["A", "2026-01-01"],
    ]);
    expect(fetch.mock.calls.filter(([input]) => String(input) === url)).toHaveLength(1);
  });

  it("discovers Other by actual types, including conditionally classified registered classes", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}custom/`]: "<> ldp:contains <one.ttl>, <empty.ttl>, <untyped.ttl>, <known.ttl> .",
      [`${STORAGE}custom/one.ttl`]: "<#it> a <https://custom.example/Unknown> .",
      [`${STORAGE}custom/empty.ttl`]: "",
      [`${STORAGE}custom/untyped.ttl`]: '<> schema:name "No class" .',
      [`${STORAGE}custom/known.ttl`]: "<> a schema:Book .",
      [`${STORAGE}creative.ttl`]: "<#it> a schema:CreativeWork .",
    });
    const result = await discoverDomainItems("other", {
      storage: STORAGE,
      fetch,
      typeIndex: [
        { forClass: "https://custom.example/Unknown", container: `${STORAGE}custom/` },
        { forClass: `${NS.SCHEMA}CreativeWork`, instance: `${STORAGE}creative.ttl` },
        { forClass: "https://custom.example/Empty" },
      ],
    });
    expect(result.items.map((item) => item.title)).toEqual(["creative.ttl", "No class", "one.ttl"]);
    expect(result.items.every((item) => item.domain.id === "other" && !item.dataType)).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("returns six recent non-container Drive files without fetching or parsing binaries", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}drive/`]: `<> a <${NS.POD_DRIVE}DriveRoot> ; ldp:contains <a.pdf>, <b.png>, <c>, <d>, <e>, <f>, <g>, <folder/>, <https://foreign.example/file> .
        <a.pdf> schema:name "A" ; dct:modified "2026-01-01" . <b.png> schema:name "B" ; dct:modified "2026-01-02" . <folder/> a ldp:Container .`,
      [`${STORAGE}docs/`]: "<> a ldp:BasicContainer ; ldp:contains <article.ttl> .",
      [`${STORAGE}docs/article.ttl`]: `<#it> a <${NS.POD_DOCS}Document> ; schema:name "Article" .`,
    });
    const result = await discoverDomainItems("documents", {
      storage: STORAGE,
      fetch,
      typeIndex: [{ forClass: `${NS.POD_DRIVE}DriveRoot`, container: `${STORAGE}drive/` }],
    });
    expect(
      result.items.filter((item) => item.dataType?.id === "files").map((item) => item.title),
    ).toEqual(["B", "A", "c", "d", "e", "f"]);
    expect(result.items.find((item) => item.dataType?.id === "docs")?.title).toBe("Article");
    expect(result.failures.map((failure) => failure.url)).toEqual(["https://foreign.example/file"]);
    expect(fetch.mock.calls.some(([input]) => String(input).endsWith(".pdf"))).toBe(false);
    expect(result.items.some((item) => item.url.endsWith("/"))).toBe(false);
  });

  it("accepts an instance registration pointing to a typed DriveRoot container", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}custom-drive/`]: `<> a <https://w3id.org/jeswr/pod-drive#DriveRoot> ; ldp:contains <one.bin> .`,
    });
    const result = await discoverDomainItems("documents", {
      storage: STORAGE,
      fetch,
      typeIndex: [{ forClass: `${NS.POD_DRIVE}DriveRoot`, instance: `${STORAGE}custom-drive/` }],
    });
    expect(result.items.map((item) => item.title)).toEqual(["one.bin"]);
  });

  it("selects the six most recent Drive files using POSIX dates and epoch seconds", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}drive/`]: `<> ldp:contains <a>, <b>, <c>, <d>, <e>, <f>, <g> .
        <a> <${NS.POSIX}mtime> "2026-01-01T00:00:00Z" .
        <g> <${NS.POSIX}mtime> 1767312000 .`,
    });
    const result = await discoverDomainItems("documents", { storage: STORAGE, fetch });
    expect(result.failures).toEqual([]);
    expect(result.items.map((item) => item.title)).toEqual(["g", "a", "b", "c", "d", "e"]);
    expect(result.items.slice(0, 2).map((item) => item.modified)).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(fetch.mock.calls.some(([input]) => /drive\/[a-g]$/.test(String(input)))).toBe(false);
  });

  it("adds profile Identity and one aggregate contact-details card, from supplied or fetched RDF", async () => {
    const body =
      '<#me> a vcard:Individual ; vcard:fn "Alice Example" ; vcard:hasEmail [ vcard:hasValue <mailto:alice@example.com> ] ; vcard:hasTelephone <tel:+123> .';
    const fetch = fixtureFetch({ [`${STORAGE}profile/card`]: body });
    const options = { storage: STORAGE, fetch, webId: WEB_ID };
    const fetched = await discoverDomainItems("personal", options);
    expect(fetched.items.map((item) => item.dataType?.id)).toEqual(["identity", "contact-details"]);
    const profile = await rdf(body, WEB_ID);
    const supplied = await discoverDomainItems(DOMAINS[0] as NonNullable<(typeof DOMAINS)[0]>, {
      ...options,
      profile,
      typeIndex: [{ forClass: `${NS.VCARD}Individual`, instance: WEB_ID }],
    });
    expect(supplied.items.map((item) => item.title)).toEqual(["Alice Example", "Contact details"]);
    expect(supplied.items[0]?.etag).toBeNull();
    const elsewhere = "https://identity.example/card#me";
    expect(
      (
        await discoverDomainItems("personal", {
          ...options,
          webId: elsewhere,
          profile: await rdf(body, elsewhere),
        })
      ).items,
    ).toHaveLength(2);
  });

  it.each([
    true,
    false,
  ])("uses the exact WebID for profile cards despite larger or preferred unrelated subjects (supplied: %s)", async (supplied) => {
    for (const linked of ["_:email", "<#it>"]) {
      const body = `<#me> a vcard:Individual ; vcard:fn "Alice" ; vcard:hasEmail ${linked} .
          ${linked} a vcard:Email ; vcard:hasValue <mailto:alice@example.com> ;
            schema:name "Email" ; schema:description "More statements than the WebID" .`;
      const fetch = fixtureFetch({ [`${STORAGE}profile/card`]: body });
      const result = await discoverDomainItems("personal", {
        storage: STORAGE,
        fetch,
        webId: WEB_ID,
        ...(supplied ? { profile: await rdf(body, WEB_ID) } : {}),
      });
      expect(result.failures).toEqual([]);
      expect(
        result.items.map((item) => [item.dataType?.id, item.title, item.subject.value]),
      ).toEqual([
        ["identity", "Alice", WEB_ID],
        ["contact-details", "Contact details", WEB_ID],
      ]);
      expect(
        fetch.mock.calls.filter(([input]) => String(input) === `${STORAGE}profile/card`),
      ).toHaveLength(supplied ? 0 : 1);
    }
  });

  it("reports partial failures, ignores nonexistent known containers, and rejects unsafe locations", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}notes/`]: 403,
      [`${STORAGE}docs/`]: new Error("offline"),
      [`${STORAGE}bookmarks/`]: "invalid RDF",
      [`${STORAGE}good.ttl`]: '<#it> a schema:TextDigitalDocument ; schema:name "Saved note" .',
    });
    const result = await discoverDomainItems("documents", {
      storage: STORAGE,
      fetch,
      typeIndex: [
        { forClass: `${NS.SCHEMA}TextDigitalDocument`, instance: `${STORAGE}good.ttl` },
        { forClass: `${NS.SCHEMA}TextDigitalDocument`, instance: "https://foreign.example/a.ttl" },
        { forClass: `${NS.SCHEMA}TextDigitalDocument`, instance: `${STORAGE}%2Fescape.ttl` },
      ],
    });
    expect(result.items.map((item) => item.title)).toEqual(["Saved note"]);
    expect(result.failures).toHaveLength(5);
    expect(fetch.mock.calls.every(([input]) => String(input).startsWith(STORAGE))).toBe(true);
    expect(result.failures.some((failure) => failure.url.includes("drive/"))).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("bounds recursive discovery and validates the domain, storage and budget", async () => {
    const fetch = fixtureFetch({
      [`${STORAGE}media/books/`]: "<> ldp:contains <one.ttl>, <two.ttl> .",
    });
    const result = await discoverDomainItems("media", { storage: STORAGE, fetch, maxRequests: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(true);
    const complete = await discoverDomainItems("financial", {
      storage: STORAGE,
      fetch,
      maxRequests: 1,
    });
    expect(complete.truncated).toBe(false);
    await expect(discoverDomainItems("missing", { storage: STORAGE, fetch })).rejects.toThrow(
      "domain",
    );
    for (const storage of ["bad", STORAGE.slice(0, -1), `${STORAGE}#fragment`])
      await expect(discoverDomainItems("media", { storage, fetch })).rejects.toThrow("root");
    for (const maxRequests of [0, -1, 0.1, Number.NaN])
      await expect(
        discoverDomainItems("media", { storage: STORAGE, fetch, maxRequests }),
      ).rejects.toThrow("budget");
  });

  it("propagates cancellation before and during reads", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = fixtureFetch({});
    await expect(
      discoverDomainItems("media", { storage: STORAGE, fetch, signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const during = new AbortController();
    const abortFetch: typeof globalThis.fetch = async () => {
      during.abort();
      throw new Error("cancelled");
    };
    await expect(
      discoverDomainItems("media", { storage: STORAGE, fetch: abortFetch, signal: during.signal }),
    ).rejects.toThrow();
  });

  it("sorts by modified descending then title without mutating input; tolerates missing dates", async () => {
    const items = (
      await discoverDomainItems("media", {
        storage: STORAGE,
        fetch: fixtureFetch({
          [`${STORAGE}media/books/`]:
            '<> ldp:contains <z>, <b>, <a> . <b> dct:modified "invalid" .',
          [`${STORAGE}media/books/z`]:
            '<> a schema:Book ; schema:name "Z" ; dct:modified "2026-01-01" .',
          [`${STORAGE}media/books/b`]: '<> a schema:Book ; schema:name "B" .',
          [`${STORAGE}media/books/a`]: '<> a schema:Book ; schema:name "A" .',
        }),
      })
    ).items;
    expect(items.map((item) => item.title)).toEqual(["Z", "A", "B"]);
    expect(sortItems([...items].reverse())).toEqual(items);
    expect(
      sortItems([
        { ...items[0], modified: "invalid" } as DomainItem,
        { ...items[1] } as DomainItem,
      ]).map((item) => item.title),
    ).toEqual(["A", "Z"]);
    expect(nameFromUrl(`${STORAGE}a%20b.ttl`)).toBe("a b.ttl");
    expect(nameFromUrl("https://pod.example/")).toBe("pod.example");
    expect(nameFromUrl("bad")).toBe("bad");
    expect(nameFromUrl(`${STORAGE}bad%ZZ`)).toBe(`${STORAGE}bad%ZZ`);
  });
});
