// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { breadcrumbs, FileError } from "../src/apps/drive/lib/files";

const root = "https://example.org/storage/";

describe("Drive breadcrumbs", () => {
  it("returns relative segments with decoded labels and encoded navigable container URLs", () => {
    expect(breadcrumbs(`${root}Drive/Work%20files/Caf%C3%A9/`, root)).toEqual([
      { label: "Drive", url: `${root}Drive/` },
      { label: "Work files", url: `${root}Drive/Work%20files/` },
      { label: "Café", url: `${root}Drive/Work%20files/Caf%C3%A9/` },
    ]);
    expect(breadcrumbs(root, root)).toEqual([]);
    expect(breadcrumbs("https://example.org/", "https://example.org/")).toEqual([]);
    expect(breadcrumbs("https://example.org/a/", "https://example.org/")).toEqual([
      { label: "a", url: "https://example.org/a/" },
    ]);
    expect(breadcrumbs(`${root}日本語/`, root)).toEqual([
      { label: "日本語", url: `${root}%E6%97%A5%E6%9C%AC%E8%AA%9E/` },
    ]);
    expect(breadcrumbs(`${root}a%252Fb/%23%3F/`, root).map((crumb) => crumb.label)).toEqual([
      "a%2Fb",
      "#?",
    ]);
    expect(breadcrumbs("http://example.org:8080/a/b/", "http://example.org:8080/a/")).toEqual([
      { label: "b", url: "http://example.org:8080/a/b/" },
    ]);
  });

  it.each([
    "https://other.example.org/storage/a/",
    "http://example.org/storage/a/",
    "https://example.org:8443/storage/a/",
    "https://example.org/storage-other/a/",
    "https://example.org/storage2/",
    "https://example.org/",
    "https://example.org/Storage/",
  ])("rejects outside-root IRI %s", (iri) =>
    expect(() => breadcrumbs(iri, root)).toThrow(
      expect.objectContaining({ code: "outside-root" }),
    ));

  it.each([
    "relative/",
    "//example.org/storage/",
    "file:///storage/",
    "https://example.org/storage",
    `${root}?q=1`,
    `${root}?`,
    `${root}#fragment`,
    `${root}#`,
    `${root}../`,
    `${root}./`,
    `${root}%2e%2e/`,
    `${root}.%2e/`,
    `${root}%2E/`,
    `${root}a/../../outside/`,
    `${root}a//b/`,
    `${root}/`,
    `${root}a%2fb/`,
    `${root}a%5Cb/`,
    `${root}a\\b/`,
    `${root}a b/`,
    ` ${root}`,
    `${root}\n`,
    `${root}%00/`,
    `${root}%7f/`,
    `${root}%C2%85/`,
    `${root}%FF/`,
    `${root}%/`,
    `${root}%A/`,
    `${root}%GG/`,
    `${root}\ud800/`,
    "https://fictional:password@example.org/storage/",
    "https://@example.org/storage/",
    "https://%65xample.org/storage/",
    "https://[invalid]/storage/",
    "https://example.org:99999/storage/",
  ])("fails closed on ambiguous/malformed IRI %j for both arguments", (iri) => {
    expect(() => breadcrumbs(iri, root)).toThrow(expect.objectContaining({ code: "invalid-iri" }));
    expect(() => breadcrumbs(root, iri)).toThrow(FileError);
  });
});
