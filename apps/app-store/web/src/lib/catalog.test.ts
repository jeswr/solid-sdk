// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// catalog.test.ts — the pure catalog helpers (live filter, query match, category
// grouping) AND a consistency check of the committed apps.json against the spec
// (17 apps, exactly the 10 live ones, every live app has a deployedUrl + a launch
// mechanism, every non-live app renders Coming soon with no autologin launch).
import { describe, expect, it } from "vitest";
import apps from "../../data/apps.json";
import { type AppEntry, CATEGORY_ORDER, groupByCategory, isLive, matchesQuery } from "./catalog";

const catalog = apps as AppEntry[];

describe("apps.json — the committed catalog matches the build spec", () => {
  it("enumerates exactly 17 apps", () => {
    expect(catalog).toHaveLength(17);
  });

  it("has exactly 10 LIVE apps (8 vite pod-apps + Solid Issues + Pod Manager)", () => {
    const live = catalog.filter(isLive);
    expect(live).toHaveLength(10);
  });

  it("every live app has a deployedUrl and a non-'none' launch mechanism", () => {
    for (const app of catalog.filter(isLive)) {
      expect(app.deployedUrl, app.id).not.toBeNull();
      expect(app.launch, app.id).not.toBe("none");
      // deployedUrl is a valid https origin on the suite domain.
      const url = new URL(app.deployedUrl as string);
      expect(url.protocol).toBe("https:");
      expect(url.host.endsWith("solid-test.jeswr.org"), app.id).toBe(true);
    }
  });

  it("every NON-live app is Coming soon: no deployedUrl, launch 'none' (never an autologin to a non-existent deploy)", () => {
    for (const app of catalog.filter((a) => !isLive(a))) {
      expect(app.deployedUrl, app.id).toBeNull();
      expect(app.launch, app.id).toBe("none");
    }
  });

  it("the 7 not-live apps are the 6 finance products + the FDC3 demo", () => {
    const notLive = catalog
      .filter((a) => !isLive(a))
      .map((a) => a.id)
      .sort();
    expect(notLive).toEqual(
      [
        "accessradar",
        "capnote",
        "fdc3-solid",
        "furlong",
        "keystone",
        "provena",
        "strongroom",
      ].sort(),
    );
  });

  it("Pod Manager uses prefill; the pod-apps + Solid Issues use autologin", () => {
    const byId = new Map(catalog.map((a) => [a.id, a]));
    expect(byId.get("solid-pod-manager")?.launch).toBe("prefill");
    for (const id of [
      "pod-drive",
      "pod-photos",
      "pod-music",
      "pod-money",
      "pod-health",
      "pod-docs",
      "pod-mail",
      "pod-chat",
      "solid-issues",
    ]) {
      expect(byId.get(id)?.launch, id).toBe("autologin");
    }
  });

  it("every category is one of the known buckets, ids are unique", () => {
    const ids = new Set<string>();
    for (const app of catalog) {
      expect(CATEGORY_ORDER).toContain(app.category);
      expect(ids.has(app.id), `duplicate id ${app.id}`).toBe(false);
      ids.add(app.id);
    }
  });
});

describe("matchesQuery", () => {
  const app: AppEntry = {
    id: "pod-photos",
    name: "Pod Photos",
    description: "Solid photo & album app with EXIF→RDF.",
    category: "Media",
    deployedUrl: "https://photos.solid-test.jeswr.org",
    status: "live",
    repo: "https://github.com/jeswr/pod-photos",
    launch: "autologin",
  };

  it("empty query matches everything", () => {
    expect(matchesQuery(app, "")).toBe(true);
    expect(matchesQuery(app, "   ")).toBe(true);
  });

  it("matches on name, description, category, id (case-insensitive)", () => {
    expect(matchesQuery(app, "photo")).toBe(true);
    expect(matchesQuery(app, "MEDIA")).toBe(true);
    expect(matchesQuery(app, "exif")).toBe(true);
    expect(matchesQuery(app, "pod-photos")).toBe(true);
  });

  it("ANDs multiple tokens", () => {
    expect(matchesQuery(app, "pod media")).toBe(true);
    expect(matchesQuery(app, "pod finance")).toBe(false);
  });
});

describe("groupByCategory", () => {
  it("groups in the fixed order and drops empty categories", () => {
    const groups = groupByCategory(catalog);
    const order = groups.map(([c]) => c);
    // The returned order is a subsequence of CATEGORY_ORDER.
    const idx = order.map((c) => CATEGORY_ORDER.indexOf(c));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    // Every app lands in exactly one group.
    const total = groups.reduce((n, [, apps]) => n + apps.length, 0);
    expect(total).toBe(catalog.length);
  });
});
