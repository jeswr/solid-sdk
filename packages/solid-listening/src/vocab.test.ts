// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  ALBUM_CLASS,
  ARTIST_CLASS,
  CORE,
  CORE_AT_TIME,
  CORE_HAD_PARTICIPANT,
  DCT_TITLE,
  FOAF_NAME,
  MEDIA,
  MEDIA_MS_PLAYED,
  MEDIA_PLAYED_WORK,
  media,
  PLAYBACK_EVENT_CLASS,
  PREFIXES,
  RDF_TYPE,
  TIME_IN_XSD_DATE_TIME,
  TIME_INSTANT_CLASS,
  TRACK_CLASS,
} from "./vocab.js";

describe("vocab IRIs", () => {
  it("reuses the media sector + core namespaces (nothing minted here)", () => {
    expect(MEDIA).toBe("https://w3id.org/jeswr/sectors/media#");
    expect(CORE).toBe("https://w3id.org/jeswr/core#");
  });

  it("names the reused media/W3C-Time classes", () => {
    expect(PLAYBACK_EVENT_CLASS).toBe("https://w3id.org/jeswr/sectors/media#PlaybackEvent");
    expect(TRACK_CLASS).toBe("https://w3id.org/jeswr/sectors/media#Track");
    expect(ARTIST_CLASS).toBe("https://w3id.org/jeswr/sectors/media#Artist");
    expect(ALBUM_CLASS).toBe("https://w3id.org/jeswr/sectors/media#Album");
    expect(TIME_INSTANT_CLASS).toBe("http://www.w3.org/2006/time#Instant");
  });

  it("names the reused predicates from media / core / dct / foaf / time", () => {
    expect(MEDIA_PLAYED_WORK).toBe("https://w3id.org/jeswr/sectors/media#playedWork");
    expect(MEDIA_MS_PLAYED).toBe("https://w3id.org/jeswr/sectors/media#msPlayed");
    expect(CORE_AT_TIME).toBe("https://w3id.org/jeswr/core#atTime");
    expect(CORE_HAD_PARTICIPANT).toBe("https://w3id.org/jeswr/core#hadParticipant");
    expect(DCT_TITLE).toBe("http://purl.org/dc/terms/title");
    expect(FOAF_NAME).toBe("http://xmlns.com/foaf/0.1/name");
    expect(TIME_IN_XSD_DATE_TIME).toBe("http://www.w3.org/2006/time#inXSDDateTime");
    expect(RDF_TYPE).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  });

  it("the media() builder concatenates onto the sector namespace", () => {
    expect(media("PlaybackEvent")).toBe(PLAYBACK_EVENT_CLASS);
  });

  it("every PREFIXES value is an absolute IRI ending in # or /", () => {
    expect(PREFIXES.media).toBe(MEDIA);
    for (const ns of Object.values(PREFIXES)) {
      expect(ns).toMatch(/^https?:\/\/.+[#/]$/);
    }
  });
});
