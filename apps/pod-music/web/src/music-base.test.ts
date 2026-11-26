// AUTHORED-BY GPT-6.1 Sol
import { deriveSession } from "@jeswr/app-session";
import { describe, expect, it } from "vitest";
import { discoverMusicBase, musicBaseFromTracksContainer } from "./music-base";

describe("musicBaseFromTracksContainer — parent of a registered tracks/ container", () => {
  it("strips a trailing tracks/ segment to yield the music base", () => {
    expect(musicBaseFromTracksContainer("https://alice.example/music/tracks/")).toBe(
      "https://alice.example/music/",
    );
  });

  it("tolerates a missing trailing slash on the registered container", () => {
    expect(musicBaseFromTracksContainer("https://alice.example/music/tracks")).toBe(
      "https://alice.example/music/",
    );
  });

  it("handles a non-conventional parent path", () => {
    expect(musicBaseFromTracksContainer("https://alice.example/my-media/tracks/")).toBe(
      "https://alice.example/my-media/",
    );
  });

  it("returns undefined when the container does not end in tracks/", () => {
    expect(musicBaseFromTracksContainer("https://alice.example/music/albums/")).toBeUndefined();
    expect(musicBaseFromTracksContainer("https://alice.example/music/")).toBeUndefined();
  });
});

describe("discoverMusicBase — Type Index first, conventional fallback", () => {
  const session = deriveSession({
    webId: "https://alice.example/#me",
    name: "Alice",
    storages: ["https://alice.example/storage/"],
    oidcIssuers: [],
  });

  it("resolves the music base from a Type-Index tracks registration", async () => {
    const store = {
      findTrackContainers: async () => ["https://alice.example/storage/music/tracks/"],
    };
    const result = await discoverMusicBase(store, session);
    expect(result.base).toBe("https://alice.example/storage/music/");
    expect(result.isFallback).toBe(false);
  });

  it("falls back to the conventional podRoot + music/ when no registration exists (and flags it)", async () => {
    const store = { findTrackContainers: async () => [] };
    const result = await discoverMusicBase(store, session);
    expect(result.base).toBe("https://alice.example/storage/music/");
    expect(result.isFallback).toBe(true);
  });

  it("falls back when the registered container is not a recognisable tracks/ container", async () => {
    const store = {
      findTrackContainers: async () => ["https://alice.example/storage/music/"],
    };
    const result = await discoverMusicBase(store, session);
    expect(result.base).toBe("https://alice.example/storage/music/");
    expect(result.isFallback).toBe(true);
  });

  it("falls back (does not throw) when discovery rejects — e.g. no profile link / 401 / parse error", async () => {
    const store = {
      findTrackContainers: async () => {
        throw new Error("no public type index linked from the profile");
      },
    };
    const result = await discoverMusicBase(store, session);
    expect(result.base).toBe("https://alice.example/storage/music/");
    expect(result.isFallback).toBe(true);
  });

  it("takes the FIRST usable tracks registration when several are returned", async () => {
    const store = {
      findTrackContainers: async () => [
        "https://alice.example/storage/not-tracks/",
        "https://alice.example/storage/library/tracks/",
      ],
    };
    const result = await discoverMusicBase(store, session);
    expect(result.base).toBe("https://alice.example/storage/library/");
    expect(result.isFallback).toBe(false);
  });
});
