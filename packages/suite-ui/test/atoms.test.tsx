// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_ICONS,
  AppIcon,
  type AppId,
  CountBadge,
  FILE_TYPES,
  FileTypeIcon,
  getFileType,
  isLocalLogo,
  Kbd,
  ProvenanceBadge,
  STATUS_DOT_LABELS,
  StatusDot,
} from "../src/index.js";

afterEach(cleanup);
async function accessible(node: ReactNode) {
  const { container } = render(<main>{node}</main>);
  // jsdom has no layout engine; browser axe and the token contrast gate cover contrast.
  expect(
    (await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations,
  ).toEqual([]);
}
const appExpectations = [
  ["home", "house", 205],
  ["drive", "hard-drive", 250],
  ["docs", "file-text", 280],
  ["tasks", "check-square-2", 150],
  ["calendar", "calendar", 40],
  ["contacts", "contact-round", 320],
  ["notes", "sticky-note", 85],
  ["photos", "image", 350],
  ["chat", "message-circle", 300],
  ["sheets", "table-2", 170],
  ["mail", "mail", 20],
  ["music", "music-2", 335],
  ["money", "wallet", 130],
  ["health", "heart-pulse", 10],
  ["permissions", "shield-check", 225],
] as const;
describe("§3 app mapping", () => {
  it("contains exactly the fifteen specified apps", () =>
    expect(Object.keys(APP_ICONS)).toEqual(appExpectations.map(([id]) => id)));
  for (const [app, glyph, hue] of appExpectations)
    it(`${app}: glyph, hue, geometry and accessible sizes`, async () => {
      expect(APP_ICONS[app]).toMatchObject({ glyph, hue });
      for (const size of [32, 40, 48] as const) {
        const { container, unmount } = render(<AppIcon app={app} size={size} />);
        const icon = screen.getByRole("img", { name: APP_ICONS[app].label });
        expect(icon.style.width).toBe(`${size}px`);
        expect(icon.style.getPropertyValue("--tile-fill")).toBe(`var(--app-${app})`);
        expect(container.querySelector("polygon")?.getAttribute("points")).toBe(
          "20,4 34,12 34,28 20,36 6,28 6,12",
        );
        expect(container.querySelector(".suite-app-glyph")?.getAttribute("width")).toBe("20");
        unmount();
      }
      await accessible(<AppIcon app={app} />);
    });
  it("can be decorative beside visible text", () => {
    render(<AppIcon app={"drive" satisfies AppId} decorative />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
const typeExpectations = [
  ["inode/directory", "folder", "folder", null, null],
  ["image/png", "image", "image", null, "photos"],
  ["application/pdf", "pdf", "file-text", "PDF", "mail"],
  ["application/msword", "document", "file-text", null, "docs"],
  ["pd:Document", "document", "file-text", null, "docs"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "document",
    "file-text",
    null,
    "docs",
  ],
  ["https://w3id.org/jeswr/pod-docs#Document", "document", "file-text", null, "docs"],
  ["application/vnd.ms-excel", "spreadsheet", "table-2", "XLS", "sheets"],
  ["text/csv", "csv", "table-2", "CSV", "sheets"],
  ["audio/mpeg", "audio", "music-2", null, "music"],
  ["video/mp4", "video", "film", null, "photos"],
  ["application/zip", "archive", "archive", null, null],
  ["text/plain", "text", "file-type", null, null],
  ["text/markdown", "text", "file-type", null, null],
  ["application/rdf+xml", "data", "database", "DATA", "home"],
  ["text/turtle", "data", "database", "DATA", "home"],
  ["application/ld+json", "data", "database", "DATA", "home"],
  ["application/unknown", "unknown", "file", null, null],
] as const;
describe("§3 file mappings", () => {
  for (const [mime, type, glyph, badge, app] of typeExpectations)
    it(`${mime}: expected glyph, badge and hue token`, async () => {
      expect(getFileType(mime)).toBe(type);
      expect(FILE_TYPES[type]).toMatchObject({ glyph, badge, app });
      const { container, unmount } = render(<FileTypeIcon contentType={mime} />);
      const icon = screen.getByRole("img", { name: FILE_TYPES[type].label });
      expect(icon.dataset.glyph).toBe(glyph);
      expect(icon.style.getPropertyValue("--file-accent")).toBe(
        app ? `var(--app-${app})` : "var(--foreground-muted)",
      );
      expect(container.querySelector(".suite-file-badge")?.textContent ?? null).toBe(badge);
      unmount();
      await accessible(<FileTypeIcon contentType={mime} />);
    });
  it.each([
    [undefined, "report.DOCX", "document"],
    ["application/octet-stream", "DATA.TTL", "data"],
    ["APPLICATION/PDF; charset=utf-8", "notes.md", "pdf"],
    ["application/unknown", "notes.md", "unknown"],
    [undefined, "report.json", "unknown"],
    ["constructor", "", "unknown"],
    [undefined, "x.__proto__", "unknown"],
  ])("resolves %s / %s", (type, name, expected) => expect(getFileType(type, name)).toBe(expected));
  it("replaces an image glyph with a thumbnail and recovers on failure", async () => {
    const { container } = render(
      <FileTypeIcon contentType="image/png" name="Photo" thumbnailSrc="/photo.png" />,
    );
    expect(container.querySelector(".lucide-image")).toBeNull();
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector(".lucide-image")).not.toBeNull();
    cleanup();
    await accessible(<FileTypeIcon contentType="image/png" thumbnailSrc="/photo.png" />);
  });
});
describe("provenance", () => {
  it.each([
    "https://third-party.example/logo.svg",
    "//third-party.example/logo.svg",
    "/\\third-party.example/logo.svg",
    "/\n/third-party.example/logo.svg",
    "data:image/png;base64,a",
    "logo.svg",
  ])("rejects nonlocal logo %s", (src) => expect(isLocalLogo(src)).toBe(false));
  it("accepts local logos and falls back after a failed load", async () => {
    const { container } = render(<ProvenanceBadge source="Spotify" logoSrc="/logos/spotify.svg" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logos/spotify.svg");
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("S")).toBeDefined();
    expect(screen.getByText("Provided by Spotify")).toBeDefined();
    cleanup();
    await accessible(<ProvenanceBadge source="Spotify" logoSrc="/logos/spotify.svg" />);
  });
  it("never renders a remote src and handles blank sources", async () => {
    const { container } = render(
      <ProvenanceBadge source="" logoSrc="https://third-party.example/logo.svg" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Provided by Unknown source")).toBeDefined();
    cleanup();
    await accessible(<ProvenanceBadge source="Spotify" />);
  });
});
it("renders a semantic accessible keyboard label", async () => {
  await accessible(<Kbd aria-label="Command or Control K">⌘/Ctrl K</Kbd>);
  expect(screen.getByLabelText("Command or Control K").tagName).toBe("KBD");
});
for (const status of Object.keys(STATUS_DOT_LABELS) as (keyof typeof STATUS_DOT_LABELS)[])
  it(`${status} status is labelled, live and accessible`, async () => {
    await accessible(<StatusDot status={status} />);
    expect(screen.getByRole("status").textContent).toBe(STATUS_DOT_LABELS[status]);
  });
for (const [count, visible] of [
  [0, "0"],
  [7, "7"],
  [99, "99"],
  [100, "99+"],
] as const)
  it(`count ${count} shows ${visible} and announces the full count`, async () => {
    await accessible(<CountBadge count={count} />);
    expect(screen.getByRole("status", { name: `${count} unread` }).textContent).toBe(visible);
  });
it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid count %s", (count) =>
  expect(() => CountBadge({ count })).toThrow(RangeError));
