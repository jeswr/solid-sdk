// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { suiteApps } from "@jeswr/suite-ui";
import { describe, expect, it } from "vitest";
import { appRegistry } from "../src/shell/registry";
import { companionApps, welcomeApps } from "../src/welcome/apps";

describe("welcome app directory", () => {
  it("includes every registry app exactly once with its route, description and status", () => {
    expect(welcomeApps.map((app) => app.slug).sort()).toEqual(
      suiteApps.map((app) => app.slug).sort(),
    );
    expect(new Set(welcomeApps.map((app) => app.slug)).size).toBe(welcomeApps.length);
    for (const app of appRegistry) {
      const card = welcomeApps.find((candidate) => candidate.slug === app.slug);
      expect(card).toMatchObject({
        name: app.name,
        basePath: app.basePath,
        hue: app.hue,
        statusLabel: app.status === "backlog" ? "Early" : "Ready to try",
      });
      expect(card?.description.length).toBeGreaterThan(15);
    }
  });
  it("uses the actual Pages slugs and GitHub READMEs for developer tools", () => {
    const deployments = JSON.parse(
      readFileSync(new URL("../../../scripts/vercel-apps.json", import.meta.url), "utf8"),
    ) as { project: string; framework: string }[];
    const pagesSlugs = deployments
      .filter((app) => app.framework === "vite")
      .map((app) => app.project.replace(/^solid-(?:sdk-)?/, ""));
    expect(new Set(companionApps.map((app) => app.id)).size).toBe(companionApps.length);
    for (const app of companionApps) {
      if (app.statusLabel === "Now in Permissions") {
        expect(app.href).toBe("/permissions");
        continue;
      }
      expect(app.href).toBe(
        app.statusLabel === "For developers"
          ? `https://github.com/jeswr/solid-sdk/tree/main/apps/${app.id}`
          : `https://jeswr.github.io/solid-sdk/${app.id}/`,
      );
      if (app.statusLabel === "Ready to try") expect(pagesSlugs).toContain(app.id);
    }
    expect(companionApps.map((app) => app.id)).toEqual(
      expect.arrayContaining([
        "app-store",
        "pod-drive",
        "pod-docs",
        "pod-chat",
        "pod-mail",
        "pod-photos",
        "pod-music",
        "pod-money",
        "pod-health",
        "extension",
        "mobile",
        "pod-migrator",
        "mcp-server",
      ]),
    );
  });
  it("points the moved Access Manager at Permissions", () => {
    expect(companionApps.find((app) => app.id === "access-manager")).toMatchObject({
      href: "/permissions",
      statusLabel: "Now in Permissions",
    });
  });
});
