// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { breadcrumbFor } from "../../src/ui/breadcrumb.js";

describe("breadcrumbFor", () => {
  it("returns a single 'Drive' crumb at the root", () => {
    expect(breadcrumbFor("https://pod.example/drive/", "https://pod.example/drive/")).toEqual([
      { url: "https://pod.example/drive/", label: "Drive" },
    ]);
  });

  it("normalises a slashless root before comparing", () => {
    expect(breadcrumbFor("https://pod.example/drive/", "https://pod.example/drive")).toEqual([
      { url: "https://pod.example/drive/", label: "Drive" },
    ]);
  });

  it("builds the trail for a nested container", () => {
    expect(
      breadcrumbFor("https://pod.example/drive/photos/2026/", "https://pod.example/drive/"),
    ).toEqual([
      { url: "https://pod.example/drive/", label: "Drive" },
      { url: "https://pod.example/drive/photos/", label: "photos" },
      { url: "https://pod.example/drive/photos/2026/", label: "2026" },
    ]);
  });

  it("decodes percent-encoded segment labels", () => {
    const crumbs = breadcrumbFor(
      "https://pod.example/drive/My%20Photos/",
      "https://pod.example/drive/",
    );
    expect(crumbs[1]).toEqual({
      url: "https://pod.example/drive/My%20Photos/",
      label: "My Photos",
    });
  });

  it("keeps a malformed percent-encoding verbatim rather than throwing", () => {
    const crumbs = breadcrumbFor(
      "https://pod.example/drive/%E0%A4%A/",
      "https://pod.example/drive/",
    );
    expect(crumbs[1]?.label).toBe("%E0%A4%A");
  });

  it("falls back to a single crumb when the current url is outside the root", () => {
    expect(breadcrumbFor("https://other.example/elsewhere/", "https://pod.example/drive/")).toEqual(
      [{ url: "https://other.example/elsewhere/", label: "elsewhere" }],
    );
  });

  it("uses the raw url as the label when the outside-root url has no segment", () => {
    expect(breadcrumbFor("weird", "https://pod.example/drive/")).toEqual([
      { url: "weird", label: "weird" },
    ]);
  });

  it("falls back to the raw url when the outside-root url trims to an empty segment", () => {
    // "/" → trimmed "" → no segment → the `|| url` fallback returns the raw url.
    expect(breadcrumbFor("/", "https://pod.example/drive/")).toEqual([{ url: "/", label: "/" }]);
  });
});
