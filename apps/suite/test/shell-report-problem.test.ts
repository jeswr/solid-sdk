// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { redact, reportProblemUrl, routePattern } from "../src/shell/lib/report-problem";

describe("problem reports", () => {
  it.each([
    "https://example.org/profile/card#me",
    "http://example.com/private?q=secret#id",
    "wss://example.org/socket?token=secret",
    "ws://example.com:3000/private",
    "file:///home/alex/private.txt",
    "HTTPS://EXAMPLE.ORG/private",
    "file:/private.txt",
    "alex@example.org",
    "a+b.c@example.co.uk",
    "áléx@exämple.org",
    '"Alex Example"@example.org',
    "alex@[192.0.2.1]",
    "alex@localhost",
    "#me",
    "#identity-123",
    "#身份",
  ])("redacts private identifier %s", (value) =>
    expect(redact(`Before ${value} after`)).toBe("Before <redacted> after"));
  it("replaces every occurrence without removing useful ordinary text", () => {
    expect(
      redact(
        'Failed https://example.org/ and https://example.com/ <ws://example.org/> "alex@example.org" #me',
      ),
    ).toBe('Failed <redacted> and <redacted> <<redacted>> "<redacted>" <redacted>');
    expect(redact("Cannot read item: permission denied.")).toBe(
      "Cannot read item: permission denied.",
    );
  });
  it.each(["f", "p", "d", "i", "a"])("reduces %s resource routes to patterns", (marker) => {
    expect(routePattern(`/drive/${marker}/private-reference/history?secret=yes#me`)).toBe(
      `/drive/${marker}/[ref]/history`,
    );
  });
  it("keeps non-resource routes and drops query and fragment", () => {
    expect(routePattern("/home?query=secret")).toBe("/home");
    expect(routePattern("/drive/my")).toBe("/drive/my");
    expect(routePattern("")).toBe("");
  });
  it("builds a bounded GitHub report without private context in title or body", () => {
    const result = new URL(
      reportProblemUrl({
        app: "Drive https://example.org",
        route: "/drive/f/SECRET?private=1",
        errorId: "id-123",
        error: `Failed at https://example.com/secret for alex@example.org #me ${"x".repeat(3000)}`,
      }),
    );
    expect(result.origin + result.pathname).toBe("https://github.com/jeswr/solid-sdk/issues/new");
    expect(result.searchParams.get("labels")).toBe("suite");
    const body = result.searchParams.get("body") ?? "";
    expect(body).toHaveLength(2000);
    expect(body).toContain("Route: /drive/f/[ref]");
    expect(body).toContain("Error ID: id-123");
    expect(body).not.toMatch(/SECRET|private|example\.(com|org)|#me/u);
    expect(result.searchParams.get("title")).toBe("Solid Suite: problem in Drive <redacted>");
  });
  it("supports missing error details and caps the title", () => {
    const url = new URL(reportProblemUrl({ app: "x".repeat(200), route: "/home" }));
    expect(url.searchParams.get("title")).toHaveLength(160);
    expect(url.searchParams.get("body")).toContain("Error ID: Not available");
  });
  it("accepts an Error without exposing private addresses", () => {
    const url = new URL(
      reportProblemUrl({
        app: "Home",
        route: "/home",
        error: new Error("Cannot read https://example.org/private"),
      }),
    );
    expect(url.searchParams.get("body")).toContain("Cannot read <redacted>");
  });
});
