// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure helper tests — no DOM needed.
import { describe, expect, it } from "vitest";
import {
  buildIssueUrl,
  composeIssueBody,
  composeIssueTitle,
  type FeedbackDiagnostics,
  feedbackLabels,
  isValidRepo,
} from "../src/feedback-core.js";

describe("buildIssueUrl", () => {
  it("builds a GitHub new-issue URL with encoded title/body/labels", () => {
    const url = buildIssueUrl({
      repo: "jeswr/pod-mail",
      title: "[Bug] it broke",
      body: "a&b c=d",
      labels: ["user-feedback", "bug"],
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://github.com");
    expect(parsed.pathname).toBe("/jeswr/pod-mail/issues/new");
    expect(parsed.searchParams.get("title")).toBe("[Bug] it broke");
    expect(parsed.searchParams.get("body")).toBe("a&b c=d");
    expect(parsed.searchParams.get("labels")).toBe("user-feedback,bug");
  });

  it("omits labels when none are given", () => {
    const url = buildIssueUrl({ repo: "jeswr/x", title: "t", body: "b", labels: [] });
    expect(new URL(url).searchParams.has("labels")).toBe(false);
  });

  it("URL-encodes injection attempts in the body so they cannot escape the query", () => {
    const url = buildIssueUrl({
      repo: "jeswr/x",
      title: "t",
      body: "https://evil.example?x=1#frag &more",
      labels: [],
    });
    const parsed = new URL(url);
    // The host stays github.com — the body is just a query value.
    expect(parsed.host).toBe("github.com");
    expect(parsed.searchParams.get("body")).toBe("https://evil.example?x=1#frag &more");
  });

  it("rejects a repo that tries to hijack the host or add a path", () => {
    expect(() =>
      buildIssueUrl({ repo: "evil.com/x?y", title: "t", body: "b", labels: [] }),
    ).toThrow();
    expect(() => buildIssueUrl({ repo: "a/b/c", title: "t", body: "b", labels: [] })).toThrow();
    expect(() =>
      buildIssueUrl({ repo: "../../etc/passwd", title: "t", body: "b", labels: [] }),
    ).toThrow();
    expect(() =>
      buildIssueUrl({ repo: "owner/repo@evil.com", title: "t", body: "b", labels: [] }),
    ).toThrow();
    expect(() =>
      buildIssueUrl({ repo: "owner/repo space", title: "t", body: "b", labels: [] }),
    ).toThrow();
  });
});

describe("isValidRepo", () => {
  it("accepts valid owner/repo names", () => {
    expect(isValidRepo("jeswr/pod-mail")).toBe(true);
    expect(isValidRepo("a/b")).toBe(true);
    expect(isValidRepo("My-Org/my.repo_name-1")).toBe(true);
  });
  it("rejects malformed / malicious names", () => {
    expect(isValidRepo("")).toBe(false);
    expect(isValidRepo("noslash")).toBe(false);
    expect(isValidRepo("a/b/c")).toBe(false);
    expect(isValidRepo("a /b")).toBe(false);
    expect(isValidRepo("a/b?c")).toBe(false);
    expect(isValidRepo("a/b#c")).toBe(false);
    expect(isValidRepo("-bad/repo")).toBe(false);
    // @ts-expect-error — exercising a non-string guard at runtime.
    expect(isValidRepo(null)).toBe(false);
  });
});

describe("composeIssueTitle", () => {
  it("prefixes the category and uses the first non-empty line", () => {
    expect(composeIssueTitle("bug", "  \nThe save button fails\nmore")).toBe(
      "[Bug] The save button fails",
    );
    expect(composeIssueTitle("feedback", "Nice app")).toBe("[Feedback] Nice app");
    expect(composeIssueTitle("help", "How do I share?")).toBe("[Help] How do I share?");
  });
  it("falls back to just the prefix for an empty description", () => {
    expect(composeIssueTitle("bug", "   ")).toBe("[Bug]");
  });
  it("truncates a very long first line", () => {
    const long = "x".repeat(200);
    const title = composeIssueTitle("bug", long);
    expect(title.length).toBeLessThan(90);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("composeIssueBody", () => {
  const base: FeedbackDiagnostics = { appName: "Pod Mail", appVersion: "1.2.3" };
  it("includes the description + diagnostics", () => {
    const body = composeIssueBody("It broke.", {
      ...base,
      pageUrl: "https://x/y",
      userAgent: "UA",
    });
    expect(body).toContain("It broke.");
    expect(body).toContain("App: Pod Mail 1.2.3");
    expect(body).toContain("Page: https://x/y");
    expect(body).toContain("UA: UA");
  });
  it("omits the WebID line unless consent was given", () => {
    const without = composeIssueBody("d", base);
    expect(without).not.toContain("Reporter WebID");
    const withConsent = composeIssueBody("d", { ...base, webId: "https://id.example/me" });
    expect(withConsent).toContain("Reporter WebID: https://id.example/me");
  });
});

describe("feedbackLabels", () => {
  it("always returns user-feedback + the category", () => {
    expect(feedbackLabels("bug")).toEqual(["user-feedback", "bug"]);
    expect(feedbackLabels("help")).toEqual(["user-feedback", "help"]);
  });
});
