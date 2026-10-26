// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { PodScopeError } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import {
  appendPlayback,
  InvalidMusicError,
  loadHistory,
  loadLibrary,
  loadMusic,
  MusicWriteError,
  type Playback,
  parseMusic,
  readHistory,
  Store,
  saveMusic,
  Track,
  type WriteCondition,
} from "../../src/apps/music/lib/model";
import { M, NS, S } from "../../src/apps/music/lib/model/vocab";

const base = "https://pod.test/music/";
const shard = `${base}history/2026-10.ttl`;
const trackIri = `${base}tracks/a.ttl#it`;
const play: Playback = {
  iri: `${shard}#play`,
  trackIri,
  startTime: new Date("2026-10-25T12:00:00Z"),
};
const turtle = (body: string, etag: string | null = '"v1"') =>
  new Response(body, {
    headers: { "content-type": "text/turtle", ...(etag === null ? {} : { etag }) },
  });
const trackTtl = `<${trackIri}> a <${S}MusicRecording>; <${S}name> "Song".`;

function transport(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  return vi.fn<typeof fetch>(async (input, init) => handler(String(input), init));
}

describe("injected RDF reads", () => {
  it("retains ETags and returns parsed datasets", async () => {
    const fetch = transport(() => turtle(trackTtl));
    const document = await loadMusic(fetch, `${base}tracks/a.ttl`);
    expect(document.etag).toBe('"v1"');
    expect(document.url).toBe(`${base}tracks/a.ttl`);
    expect(document.dataset.size).toBe(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads multi-subject Spotify files and guards every untrusted listing URL", async () => {
    const root = `${base}tracks/`;
    const fetch = transport((url, init) => {
      expect(init?.redirect).toBe("manual");
      if (url === root)
        return turtle(`
        <${root}> <${NS.LDP}contains> <${root}a.ttl>, <${root}b.ttl>, <${root}sub/>,
          <https://evil.test/steal>, <${base}private.ttl>, <${root}>, <${root}?self>,
          <${root}..%2fsecret>, <javascript:evil>, "bad", [] .
      `);
      if (url === `${root}a.ttl`) return turtle(trackTtl);
      if (url === `${root}b.ttl`)
        return turtle(
          `<${root}b.ttl#b> a <${S}MusicRecording>; <${S}name> "Another". <${root}b.ttl#c> a <${S}MusicRecording>; <${S}name> "Third".`,
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    const library = await loadLibrary(fetch, root);
    expect(library.tracks.map((track) => track.title)).toEqual(["Another", "Song", "Third"]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([root, `${root}a.ttl`, `${root}b.ttl`]);
  });

  it("scopes JSON-LD blank artists and albums to each document, including the listing", async () => {
    const documents = [base, `${base}a.jsonld`, `${base}b.jsonld`];
    const fetch = transport((url) => {
      const index = documents.indexOf(url);
      expect(index).toBeGreaterThanOrEqual(0);
      return new Response(
        JSON.stringify([
          {
            "@id": base,
            [`${NS.LDP}contains`]: documents.slice(1).map((child) => ({ "@id": child })),
          },
          ...["one", "two"].map((id) => ({
            "@id": `${url}#${id}`,
            "@type": `${S}MusicRecording`,
            [`${S}name`]: `${index}-${id}`,
            [`${S}byArtist`]: { "@id": "_:artist" },
            [`${S}inAlbum`]: { "@id": "_:album" },
          })),
          { "@id": "_:artist", [`${S}name`]: `Artist ${index}` },
          { "@id": "_:album", [`${S}name`]: `Album ${index}` },
        ]),
        { headers: { "content-type": "application/ld+json" } },
      );
    });
    const library = await loadLibrary(fetch, base);
    expect(library.tracks.map((track) => [track.title, track.artists, track.album])).toEqual(
      documents.flatMap((_url, index) =>
        ["one", "two"].map((id) => [
          `${index}-${id}`,
          [{ iri: undefined, name: `Artist ${index}` }],
          { iri: undefined, name: `Album ${index}` },
        ]),
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("renames blank graph names consistently with their subject and object uses", async () => {
    const fetch = transport(
      () =>
        new Response(
          JSON.stringify([
            { "@id": "_:node", [`${S}name`]: "Graph and artist" },
            {
              "@id": "_:node",
              "@graph": [{ "@id": trackIri, [`${S}byArtist`]: { "@id": "_:node" } }],
            },
          ]),
          { headers: { "content-type": "application/ld+json" } },
        ),
    );
    const first = await loadMusic(fetch, base);
    const second = await loadMusic(fetch, base);
    const artist = first.dataset.getQuads(trackIri, `${S}byArtist`, null, null)[0]?.object;
    if (!artist) throw new Error("Missing blank artist");
    expect(artist.termType).toBe("BlankNode");
    expect(first.dataset.getQuads(null, `${S}name`, null, null)[0]?.subject.equals(artist)).toBe(
      true,
    );
    expect(first.dataset.getQuads(trackIri, null, null, null)[0]?.graph.equals(artist)).toBe(true);
    expect(new Track(trackIri, second.dataset).objects(`${S}byArtist`)[0]?.equals(artist)).toBe(
      false,
    );
  });

  it("distinguishes empty listings, HTTP errors, parse failures and network failures", async () => {
    expect(
      (
        await loadLibrary(
          transport(() => turtle("")),
          base,
        )
      ).tracks,
    ).toEqual([]);
    for (const status of [401, 403, 404, 500]) {
      await expect(
        loadMusic(
          transport(() => new Response(null, { status })),
          base,
        ),
      ).rejects.toMatchObject({ status });
    }
    await expect(
      loadMusic(
        transport(() => turtle("invalid turtle")),
        base,
      ),
    ).rejects.toBeInstanceOf(RdfFetchError);
    await expect(
      loadMusic(
        transport(() => {
          throw new TypeError("network");
        }),
        base,
      ),
    ).rejects.toBeInstanceOf(RdfFetchError);
    const childError = transport((url) =>
      url === base
        ? turtle(`<${base}> <${NS.LDP}contains> <${base}child.ttl>.`)
        : new Response(null, { status: 403 }),
    );
    await expect(loadLibrary(childError, base)).rejects.toMatchObject({ status: 403 });
  });

  it("does not follow a listing redirect outside the configured container", async () => {
    const fetch = transport(
      () => new Response(null, { status: 302, headers: { location: "https://evil.test/steal" } }),
    );
    await expect(loadLibrary(fetch, base)).rejects.toBeInstanceOf(RdfFetchError);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("conditional RDF writes", () => {
  it("creates and updates with explicit preconditions and content type", async () => {
    const dataset = new Store();
    const track = new Track(trackIri, dataset).stampType();
    track.title = "Song";
    const fetch = transport(async (url, init) => {
      expect(url).toBe(`${base}tracks/a.ttl`);
      expect(init?.method).toBe("PUT");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("content-type")).toBe("text/turtle");
      const saved = await parseMusic(String(init?.body), url);
      expect(new Track(trackIri, saved).title).toBe("Song");
      return new Response(null, { status: 201, headers: { etag: '"v2"' } });
    });
    expect(await saveMusic(fetch, base, `${base}tracks/a.ttl`, dataset, { ifNoneMatch: "*" })).toBe(
      '"v2"',
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("if-none-match")).toBe("*");
    expect(await saveMusic(fetch, base, `${base}tracks/a.ttl`, dataset, { ifMatch: '"v1"' })).toBe(
      '"v2"',
    );
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("if-match")).toBe('"v1"');
    expect(
      await saveMusic(
        transport(() => new Response(null, { status: 204 })),
        base,
        `${base}tracks/a.ttl`,
        dataset,
        { ifMatch: "*" },
      ),
    ).toBeNull();
  });

  it("fails before sending missing preconditions or escaped targets", async () => {
    const fetch = transport(() => new Response(null, { status: 204 }));
    for (const condition of [{}, { ifMatch: "" }, { ifNoneMatch: "wrong" }]) {
      await expect(
        saveMusic(fetch, base, `${base}tracks/a.ttl`, new Store(), condition as WriteCondition),
      ).rejects.toBeInstanceOf(InvalidMusicError);
    }
    for (const url of [
      base,
      `${base}?self`,
      "https://evil.test/a",
      "https://pod.test/private",
      `${base}..%2fsecret`,
    ]) {
      await expect(
        saveMusic(fetch, base, url, new Store(), { ifMatch: "*" }),
      ).rejects.toBeInstanceOf(PodScopeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves structured conflicts and refuses write redirects", async () => {
    const fetch = transport(
      () => new Response(null, { status: 412, headers: { etag: '"remote"' } }),
    );
    await expect(
      saveMusic(fetch, base, shard, new Store(), { ifMatch: '"old"' }),
    ).rejects.toMatchObject({ name: "MusicWriteError", status: 412, etag: '"remote"' });
    await expect(
      saveMusic(
        transport(() => new Response(null, { status: 403 })),
        base,
        shard,
        new Store(),
        { ifMatch: "*" },
      ),
    ).rejects.toBeInstanceOf(MusicWriteError);
    const redirect = transport(
      () => new Response(null, { status: 307, headers: { location: `${base}elsewhere` } }),
    );
    await expect(
      saveMusic(redirect, base, shard, new Store(), { ifMatch: "*" }),
    ).rejects.toBeInstanceOf(PodScopeError);
    expect(redirect).toHaveBeenCalledOnce();
  });
});

describe("monthly history I/O", () => {
  it("keeps same-labelled JSON-LD instants separate across monthly documents", async () => {
    const months = [new Date("2026-09-25T12:00:00Z"), play.startTime];
    const fetch = transport((url) => {
      const date = months.find((month) => url.includes(month.toISOString().slice(0, 7)));
      return new Response(
        JSON.stringify([
          ...["one", "two"].map((id) => ({
            "@id": `${url}#${id}`,
            "@type": `${M}PlaybackEvent`,
            [`${M}playedWork`]: { "@id": trackIri },
            [`${NS.CORE}atTime`]: { "@id": "_:instant" },
          })),
          { "@id": "_:instant", [`${NS.TIME}inXSDDateTime`]: date?.toISOString() },
        ]),
        { headers: { "content-type": "application/ld+json" } },
      );
    });
    const history = await loadHistory(fetch, base, months);
    expect(history.map((event) => [event.iri, event.startTime])).toEqual(
      [...months]
        .reverse()
        .flatMap((month) =>
          ["one", "two"].map((id) => [
            `${base}history/${month.toISOString().slice(0, 7)}.ttl#${id}`,
            month,
          ]),
        ),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads selected months once each, tolerating only missing shards", async () => {
    const previous = `${base}history/2026-09.ttl`;
    const fetch = transport((url) => {
      if (url === shard)
        return turtle(
          `<${play.iri}> a <${S}ListenAction>; <${S}object> <${trackIri}>; <${S}startTime> "2026-10-25T12:00:00Z".`,
        );
      expect(url).toBe(previous);
      return new Response(null, { status: 404 });
    });
    expect(
      await loadHistory(fetch, base, [play.startTime, play.startTime, new Date("2026-09-01")]),
    ).toEqual([{ ...play, endTime: undefined, agent: undefined }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await loadHistory(fetch, base, [])).toEqual([]);
    await expect(
      loadHistory(
        transport(() => new Response(null, { status: 403 })),
        base,
        [play.startTime],
      ),
    ).rejects.toMatchObject({ status: 403 });
    // A scope refusal is wrapped by fetch-rdf; date validation is a separate local error.
    await expect(loadHistory(fetch, base, [new Date("bad")])).rejects.toBeInstanceOf(
      InvalidMusicError,
    );
    await expect(
      loadHistory(
        transport(() => turtle("bad")),
        base,
        [play.startTime],
      ),
    ).rejects.toBeInstanceOf(RdfFetchError);
  });

  it("creates a missing shard and appends to an existing one with its ETag", async () => {
    let body: string | undefined;
    const fetch = transport((_url, init) => {
      if (init?.method !== "PUT")
        return body === undefined ? new Response(null, { status: 404 }) : turtle(body, '"v2"');
      const headers = new Headers(init.headers);
      expect(headers.get(body === undefined ? "if-none-match" : "if-match")).toBe(
        body === undefined ? "*" : '"v2"',
      );
      body = String(init.body);
      return new Response(null, { status: 201, headers: { etag: '"v2"' } });
    });
    const first = await appendPlayback(fetch, base, play);
    expect(first.etag).toBe('"v2"');
    expect(readHistory(first.dataset)).toHaveLength(1);
    const second = await appendPlayback(fetch, base, {
      ...play,
      iri: `${shard}#second`,
      endTime: new Date("2026-10-25T12:03:33Z"),
      agent: "https://pod.test/profile#me",
    });
    expect(readHistory(second.dataset)).toHaveLength(2);
    // Same event ID is idempotent, while separate listens of one track remain separate.
    expect(readHistory((await appendPlayback(fetch, base, play)).dataset)).toHaveLength(2);
  });

  it("does not overwrite conflicts, ignore denied reads or append without an ETag", async () => {
    const initial = `<${shard}#old> a <${S}ListenAction>; <${S}object> <${trackIri}>; <${S}startTime> "2026-10-01T12:00:00Z".`;
    const conflict = transport((_url, init) =>
      init?.method === "PUT"
        ? new Response(null, { status: 412, headers: { etag: '"v3"' } })
        : turtle(initial),
    );
    await expect(appendPlayback(conflict, base, play)).rejects.toMatchObject({
      status: 412,
      etag: '"v3"',
    });
    expect(conflict).toHaveBeenCalledTimes(2);
    const noEtag = transport(() => turtle(initial, null));
    await expect(appendPlayback(noEtag, base, play)).rejects.toBeInstanceOf(InvalidMusicError);
    expect(noEtag).toHaveBeenCalledOnce();
    await expect(
      appendPlayback(
        transport(() => new Response(null, { status: 401 })),
        base,
        play,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      appendPlayback(
        transport(() => {
          throw new Error("network");
        }),
        base,
        play,
      ),
    ).rejects.toBeInstanceOf(RdfFetchError);
  });

  it("requires event identifiers to be fragments of the correct monthly document", async () => {
    for (const iri of [
      `${base}history/2026-09.ttl#wrong`,
      shard,
      `${shard}#`,
      "https://evil.test/a#it",
    ]) {
      const fetch = transport(() => new Response(null, { status: 404 }));
      await expect(appendPlayback(fetch, base, { ...play, iri })).rejects.toThrow();
      expect(fetch).toHaveBeenCalledOnce();
    }
    const fetch = transport(() => new Response(null, { status: 404 }));
    await expect(
      appendPlayback(fetch, base, { ...play, startTime: new Date("bad") }),
    ).rejects.toBeInstanceOf(InvalidMusicError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
