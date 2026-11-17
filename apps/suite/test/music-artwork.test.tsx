// AUTHORED-BY Codex GPT-6
// biome-ignore-all assist/source/organizeImports: Establish the DOM before importing browser components.
import { act, deferred, h, mount } from "./drive-ui-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Artwork } from "../src/apps/music/components/artwork";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../src/apps/music/state/music-context", () => ({ useMusic: () => ({}) }));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session }),
}));
const session = { storageUrl: "https://artwork.test/", fetch: state.fetch };
afterEach(() => vi.restoreAllMocks());
it("shares one authenticated cover URL across album rows and revokes after the last unmount", async () => {
  const response = deferred<Response>();
  state.fetch.mockReturnValue(response.promise);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-cover");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const rows = (count: number) =>
    h(
      "div",
      {},
      ...Array.from({ length: count }, (_, i) =>
        h(Artwork, { key: i, name: "Album", image: "https://artwork.test/cover.png" }),
      ),
    );
  const view = await mount(rows(30));
  expect(state.fetch).toHaveBeenCalledTimes(1);
  await act(async () =>
    response.resolve(new Response("cover", { headers: { "Content-Type": "image/png" } })),
  );
  expect(view.host.querySelectorAll('img[src="blob:shared-cover"]')).toHaveLength(30);
  await view.render(rows(1));
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:shared-cover");
});

it("cancels the last pending cover and revokes a late object URL", async () => {
  const { acquireCoverUrl } = await import("../src/apps/music/lib/browser/object-url");
  const response = deferred<Response>();
  const fetch = vi.fn(() => response.promise);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late-cover");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const cover = acquireCoverUrl(fetch, session.storageUrl, "https://artwork.test/late.png");
  const shared = acquireCoverUrl(fetch, session.storageUrl, "https://artwork.test/late.png");
  cover.release();
  cover.release();
  expect(fetch.mock.calls).toHaveLength(1);
  shared.release();
  response.resolve(new Response("cover"));
  await cover.promise;
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:late-cover");
});
it("does not share cover bytes between authenticated sessions and releases failed requests", async () => {
  const { acquireCoverUrl } = await import("../src/apps/music/lib/browser/object-url");
  const denied = vi.fn(async () => new Response(null, { status: 403 }));
  const other = vi.fn(async () => new Response("other cover"));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:other-cover");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const first = acquireCoverUrl(denied, session.storageUrl, "https://artwork.test/cover.png");
  const second = acquireCoverUrl(other, session.storageUrl, "https://artwork.test/cover.png");
  await expect(first.promise).rejects.toThrow("File unavailable");
  expect(await second.promise).toBe("blob:other-cover");
  first.release();
  second.release();
  expect(denied).toHaveBeenCalledOnce();
  expect(other).toHaveBeenCalledOnce();
});
