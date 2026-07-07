// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// catalog.test.ts — the pure catalog helpers (live filter, query match, category
// grouping) AND a consistency check of the committed apps.json against the spec.
// The catalog is the COMPLETE directory of the suite's user-facing apps: the 8 vite
// pod-apps + Solid Issues + Pod Manager (suite-hosted on solid-test.jeswr.org, with
// an autologin/prefill deep-link), PLUS the externally-hosted live apps (the OSS
// forks + standalone apps on Vercel / jeswr.org, which carry NO identity deep-link so
// they launch as a plain "Open" link, launch: "none"), PLUS the not-yet-deployed apps
// (finance products, the FDC3 demo, the deploy-deferred forks) rendered "Coming soon".
import { describe, expect, it } from "vitest";
import apps from "../../data/apps.json";
import {
  type AppEntry,
  CATEGORY_ORDER,
  groupByCategory,
  isLive,
  launchVerb,
  matchesQuery,
} from "./catalog";

const catalog = apps as AppEntry[];

describe("apps.json — the committed catalog matches the build spec", () => {
  it("enumerates exactly 27 apps", () => {
    expect(catalog).toHaveLength(27);
  });

  it("has exactly 17 LIVE apps", () => {
    const live = catalog.filter(isLive);
    expect(live).toHaveLength(17);
  });

  it("every live app has a valid https deployedUrl", () => {
    for (const app of catalog.filter(isLive)) {
      expect(app.deployedUrl, app.id).not.toBeNull();
      const url = new URL(app.deployedUrl as string);
      expect(url.protocol, app.id).toBe("https:");
    }
  });

  it("suite-hosted live apps use an autologin/prefill deep-link on solid-test.jeswr.org; external live apps use launch 'none'", () => {
    for (const app of catalog.filter(isLive)) {
      const host = new URL(app.deployedUrl as string).host;
      if (app.launch === "none") {
        // Externally-hosted (fork / standalone) — a plain Open link, off the suite domain.
        expect(host.endsWith("solid-test.jeswr.org"), app.id).toBe(false);
      } else {
        // Suite-hosted deep-link target.
        expect(host.endsWith("solid-test.jeswr.org"), app.id).toBe(true);
      }
    }
  });

  it("every NON-live app is Coming soon: no deployedUrl, launch 'none' (never an autologin to a non-existent deploy)", () => {
    for (const app of catalog.filter((a) => !isLive(a))) {
      expect(app.deployedUrl, app.id).toBeNull();
      expect(app.launch, app.id).toBe("none");
    }
  });

  it("the 10 not-live apps are the finance products, the FDC3 demo, and the deploy-deferred forks", () => {
    const notLive = catalog
      .filter((a) => !isLive(a))
      .map((a) => a.id)
      .sort();
    expect(notLive).toEqual(
      [
        "accessradar",
        "actual",
        "capnote",
        "fdc3-solid",
        "furlong",
        "keystone",
        "miniflux",
        "provena",
        "strongroom",
        "web-scrobbler",
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

describe("launchVerb — 'Launch' only when identity is actually carried", () => {
  const suiteApp: AppEntry = {
    id: "pod-drive",
    name: "Pod Drive",
    description: "x",
    category: "Documents",
    deployedUrl: "https://drive.solid-test.jeswr.org",
    status: "live",
    repo: null,
    launch: "autologin",
  };
  const externalApp: AppEntry = { ...suiteApp, id: "elk", launch: "none" };
  const WEBID = "https://alice.solid-test.jeswr.org/profile/card#me";

  it("suite deep-link app, signed in → Launch", () => {
    expect(launchVerb(suiteApp, WEBID)).toBe("Launch");
  });
  it("suite deep-link app, signed out → Open", () => {
    expect(launchVerb(suiteApp, null)).toBe("Open");
  });
  it("external app (launch 'none') is ALWAYS Open, even signed in (no SSO is carried)", () => {
    expect(launchVerb(externalApp, WEBID)).toBe("Open");
    expect(launchVerb(externalApp, null)).toBe("Open");
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
