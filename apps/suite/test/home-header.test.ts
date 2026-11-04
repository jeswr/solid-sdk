// AUTHORED-BY Codex GPT-6
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeHeader, type HomeHeaderProps } from "../src/apps/home/components/home-header";

const base: HomeHeaderProps = {
  displayName: "Alice Wilder",
  items: [],
  used: 1024,
  status: "ready",
  now: Date.parse("2026-11-01T09:00:00Z"),
  onRetry: () => {},
};
const render = (props: Partial<HomeHeaderProps> = {}) =>
  renderToStaticMarkup(createElement(HomeHeader, { ...base, ...props }));

describe("Home header access seam", () => {
  it("settles unavailable access and storage usage without a misleading total or perpetual loading", () => {
    const html = render({ access: "failed", used: undefined });
    expect(html).toContain("Couldn&#x27;t check who has access.");
    expect(html).not.toContain("Checking who has access");
    expect(html).toContain("Storage usage unavailable");
    expect(html).not.toContain("Your storage doesn&#x27;t report a limit");
  });
  it("uses interim copy while access counts are unavailable", () => {
    const html = render();
    expect(html).toContain("See who has access");
    expect(html).toContain("Checking who has access…");
    expect(html).toContain('href="/permissions"');
    expect(html).toContain("No changes yet");
    expect(html).toContain("Your storage doesn&#x27;t report a limit");
  });
  it("pluralises app, person and public-item counts", () => {
    const single = render({ access: { apps: 1, people: 1, publicItems: 1 } });
    expect(single).toContain("1 app and 1 person have access");
    expect(single).toContain("Anyone with the link can see 1 item");
    const multiple = render({ access: { apps: 2, people: 3, publicItems: 4 } });
    expect(multiple).toContain("2 apps and 3 people have access");
    expect(multiple).toContain("Anyone with the link can see 4 items");
    expect(render({ access: { apps: 0, people: 0, publicItems: 3 } })).toContain(
      "0 apps and 0 people have access",
    );
  });
  // AUTHORED-BY Claude Opus 5.5 — finding 10
  it("says when the offline copy is from, and only while offline", () => {
    const asOf = Date.parse("2026-11-01T08:42:00Z");
    const time = new Date(asOf).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(render({ offline: true, asOf })).toContain(
      `You&#x27;re offline. This is your pod as of ${time}.`,
    );
    expect(render({ asOf })).not.toContain("offline");
    expect(render({ offline: true })).not.toContain("as of");
  });
  it("settles an empty access snapshot as owner-only access", () => {
    const empty = render({ access: { apps: 0, people: 0, publicItems: 0 } });
    expect(empty).toContain("Only you have access");
    expect(empty).toContain('href="/permissions"');
    expect(empty).not.toContain("Anyone with the link");
    expect(empty).not.toContain("Checking who has access");
  });
});
