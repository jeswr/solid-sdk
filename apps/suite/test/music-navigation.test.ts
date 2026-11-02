// AUTHORED-BY Codex GPT-6
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MusicApp } from "../src/apps/music/components/music-app";
import { albumHref, artistHref, playlistHref } from "../src/apps/music/lib/navigation";
import { encodeRef } from "../src/lib/refs";

vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) =>
    h("div", {}, sidebar, children),
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({
    status: "ready",
    session: { webId: "https://pod.test/#me", storageUrl: "https://pod.test/" },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/music" }));
vi.mock("../src/apps/music/components/playlist-dialogs", () => ({ CreatePlaylist: () => null }));
vi.mock("../src/apps/music/state/music-context", () => ({
  MusicProvider: ({ children }: { children: ReactNode }) => children,
  useMusic: () => ({
    snapshot: {
      library: { tracks: [] },
      playlists: [{ id: "urn:playlist:123", name: "Imported playlist" }],
      preferences: { value: { artwork: "none" } },
    },
  }),
}));

it.each([
  [albumHref, "a", "albums"],
  [artistHref, "ar", "artists"],
  [playlistHref, "p", "playlists"],
] as const)("validates every %s resource link and safely falls back to its collection", (href, segment, collection) => {
  for (const id of [
    "urn:playlist:123",
    "urn:album:123",
    "mailto:artist@example.test",
    "not a URL",
    "javascript:alert(1)",
    "https://user:password@pod.test/music/",
  ])
    expect(href(id)).toBe(`/music/${collection}`);
  for (const id of ["https://pod.test/music/a.ttl#it", "http://pod.test/music/b.ttl?track=1#é"])
    expect(href(id)).toBe(`/music/${segment}/${encodeRef(id)}`);
});

it("keeps the shared Music sidebar renderable with a non-HTTP playlist identity", () => {
  const markup = renderToStaticMarkup(h(MusicApp, null, h("h1", {}, "Your music")));
  expect(markup).toContain("Your music");
  expect(markup).toContain('href="/music/playlists"');
  expect(markup).toContain("Imported playlist");
  expect(markup).not.toContain("urn:playlist:123");
});
