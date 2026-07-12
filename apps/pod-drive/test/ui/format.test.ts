// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { type DriveResource, readContainer } from "../../src/model.js";
import {
  displayName,
  errorMessage,
  formatKind,
  formatModified,
  formatSize,
} from "../../src/ui/format.js";
import { turtle } from "../helpers.js";

/** Find a container child matching `predicate`, failing the test if absent (no `!`). */
function child(ttl: string, base: string, predicate: (r: DriveResource) => boolean): DriveResource {
  const container = readContainer(base, turtle(ttl));
  const match = [...container.contains].find(predicate);
  if (match === undefined) {
    throw new Error("expected child not found");
  }
  return match;
}

describe("formatSize", () => {
  it("returns an em-dash when size is absent", () => {
    expect(formatSize(undefined)).toBe("—");
  });

  it("renders raw bytes under 1 KB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("scales up through KB / MB / GB / TB", () => {
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1 MB");
    expect(formatSize(1024 * 1024 * 1024)).toBe("1 GB");
    expect(formatSize(1024 ** 4)).toBe("1 TB");
  });

  it("clamps at TB for very large values (no PB unit)", () => {
    expect(formatSize(1024 ** 5)).toBe("1024 TB");
  });
});

describe("formatModified", () => {
  it("returns an em-dash when the date is absent", () => {
    expect(formatModified(undefined)).toBe("—");
  });

  it("formats a date as YYYY-MM-DD (UTC)", () => {
    expect(formatModified(new Date("2026-06-15T12:34:56Z"))).toBe("2026-06-15");
  });
});

const TTL = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
<https://pod.example/d/> a ldp:Container ;
  ldp:contains <https://pod.example/d/sub/>, <https://pod.example/d/typed.png>,
    <https://pod.example/d/plain.bin> .
<https://pod.example/d/sub/> a ldp:Container .
<https://pod.example/d/typed.png> a ldp:Resource ; dcterms:format "image/png" .
<https://pod.example/d/plain.bin> a ldp:Resource .
`;

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error thrown value", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("formatKind", () => {
  it("labels a container Folder", () => {
    const sub = child(TTL, "https://pod.example/d/", (r) => r.isContainer);
    expect(formatKind(sub)).toBe("Folder");
  });

  it("uses dcterms:format for a typed file", () => {
    const png = child(TTL, "https://pod.example/d/", (r) => r.url.endsWith("typed.png"));
    expect(formatKind(png)).toBe("image/png");
  });

  it("falls back to File when no content type is exposed", () => {
    const bin = child(TTL, "https://pod.example/d/", (r) => r.url.endsWith("plain.bin"));
    expect(formatKind(bin)).toBe("File");
  });
});

describe("displayName", () => {
  it("returns the resource's decoded last-segment name", () => {
    const png = child(TTL, "https://pod.example/d/", (r) => r.url.endsWith("typed.png"));
    expect(displayName(png)).toBe("typed.png");
  });

  it("decodes a percent-encoded name", () => {
    const ttl = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/d/> a ldp:Container ; ldp:contains <https://pod.example/d/My%20File.txt> .
<https://pod.example/d/My%20File.txt> a ldp:Resource .
`;
    const file = child(ttl, "https://pod.example/d/", (r) => r.url.endsWith("My%20File.txt"));
    expect(displayName(file)).toBe("My File.txt");
  });
});
