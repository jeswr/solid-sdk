// AUTHORED-BY Codex GPT-6.1-Sol
import { APP_ICONS, suiteApps } from "@jeswr/suite-ui";
import { describe, expect, it } from "vitest";
import { appForPath, appRegistry, visibleApps } from "../src/shell/lib/registry";

describe("shell registry", () => {
  it("registers every suite app with its design-system hue and a default root nav", () => {
    expect(appRegistry.map((app) => app.slug)).toEqual(suiteApps.map((app) => app.slug));
    for (const app of appRegistry) {
      expect(app.hue).toBe(APP_ICONS[app.slug].hue);
      if (app.status === "backlog") expect(app.sidebar).toBeUndefined();
      else {
        expect(app.sidebar?.({ pathname: app.basePath })[0]?.items[0]).toMatchObject({
          href: app.basePath,
          current: true,
        });
        expect(app.sidebar?.({ pathname: `${app.basePath}/child` })[0]?.items[0]?.current).toBe(
          false,
        );
      }
    }
  });
  it("matches only path segments and chooses the longest root", () => {
    expect(appForPath("/docs")?.slug).toBe("docs");
    expect(appForPath("/docs/d/ref/history")?.slug).toBe("docs");
    expect(appForPath("/docsx")).toBeUndefined();
    expect(appForPath("/")).toBeUndefined();
    const nested = {
      slug: "home" as const,
      name: "Nested",
      hue: 205,
      status: "first-cut" as const,
      basePath: "/docs/nested",
    };
    expect(appForPath("/docs/nested/item", [...appRegistry, nested])).toEqual(nested);
  });
  it("hides backlog apps by default", () => {
    expect(visibleApps(false).map((app) => app.slug)).toEqual([
      "home",
      "drive",
      "docs",
      "tasks",
      "permissions",
      "calendar",
    ]);
    expect(visibleApps(true)).toEqual(appRegistry);
  });
});
