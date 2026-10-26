// AUTHORED-BY Codex
import { afterEach, describe, expect, it, vi } from "vitest";
import { readExportImage } from "../src/apps/docs/editor/export-document";
import type { PodSession } from "../src/lib/session/pod-session";

afterEach(() => vi.unstubAllGlobals());
const sessionFor = (fetchImpl: typeof fetch): PodSession => ({
  mode: "demo",
  webId: "https://pod.test/profile#me",
  displayName: "Alice",
  storageUrl: "https://pod.test/",
  fetch: fetchImpl,
  subscribe: () => () => {},
  reset: async () => {},
});
function imageEnvironment() {
  const close = vi.fn();
  const bitmap = { width: 100, height: 50, close };
  const drawImage = vi.fn();
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (callback: (blob: Blob) => void) => callback(png),
  };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  vi.stubGlobal("document", { createElement: () => canvas });
  return { close, drawImage, bitmap };
}
describe("DOCX authenticated image loading", () => {
  it("authenticates only pod-origin images, refuses redirects and strips credentials from external requests", async () => {
    const { close, drawImage, bitmap } = imageEnvironment();
    const response = () =>
      new Response(new Uint8Array([1]), { headers: { "content-type": "image/webp" } });
    const authenticated = vi.fn<typeof fetch>(async () => response());
    const anonymous = vi.fn<typeof fetch>(async () => response());
    vi.stubGlobal("fetch", anonymous);
    const session = sessionFor(authenticated);
    const image = await readExportImage(session, "https://pod.test/assets/private.webp");
    expect(authenticated).toHaveBeenCalledWith("https://pod.test/assets/private.webp", {
      redirect: "error",
    });
    expect(anonymous).not.toHaveBeenCalled();
    expect(image).toEqual({ type: "png", data: new Uint8Array([1, 2, 3]), width: 100, height: 50 });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    await readExportImage(session, "https://images.test/public.png");
    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(anonymous).toHaveBeenCalledWith("https://images.test/public.png", {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("rejects executable URLs and non-images so the converter can emit its unavailable fallback", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("<html>not an image</html>", { headers: { "content-type": "text/html" } }),
    );
    const session = sessionFor(fetchImpl);
    for (const src of [
      "javascript:alert(1)",
      "data:image/png;base64,x",
      "https://user:pass@pod.test/image.png",
    ]) {
      await expect(readExportImage(session, src)).rejects.toThrow("Invalid image URL");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(readExportImage(session, "https://pod.test/image.png")).rejects.toThrow(
      "Image unavailable",
    );
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(readExportImage(session, "https://pod.test/missing.png")).rejects.toThrow(
      "Image unavailable",
    );
  });
});
