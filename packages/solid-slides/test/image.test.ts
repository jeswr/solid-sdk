// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it, vi } from "vitest";
import { readSlideImage } from "../src/image.js";

it("loads raster bytes with an explicit redirect policy", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "IMAGE/PNG; charset=binary" },
      }),
  );
  const blob = await readSlideImage(fetch, "https://pod.example/image");
  expect(blob.size).toBe(3);
  expect(blob.type).toBe("image/png");
  expect(fetch).toHaveBeenCalledWith("https://pod.example/image", {
    redirect: "error",
    signal: undefined,
  });
});
it("refuses invalid schemes, errors and active formats", async () => {
  const fetch = vi.fn();
  await expect(readSlideImage(fetch, "javascript:alert(1)")).rejects.toThrow(TypeError);
  expect(fetch).not.toHaveBeenCalled();
  for (const response of [
    new Response("no", { status: 403 }),
    new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    new Response(null),
  ]) {
    await expect(
      readSlideImage(
        vi.fn(async () => response),
        "https://pod.example/image",
      ),
    ).rejects.toThrow("Image unavailable");
  }
});
it("caps actual streamed bytes and accepts an empty successful image", async () => {
  const huge = new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
    headers: { "content-type": "image/png" },
  });
  await expect(
    readSlideImage(
      vi.fn(async () => huge),
      "https://pod.example/image",
    ),
  ).rejects.toThrow(RangeError);
  const empty = new Response(null, { headers: { "content-type": "image/jpeg" } });
  expect(
    (
      await readSlideImage(
        vi.fn(async () => empty),
        "https://pod.example/image",
      )
    ).size,
  ).toBe(0);
  const controller = new AbortController();
  controller.abort();
  await expect(
    readSlideImage(
      vi.fn(async () => new Response("x", { headers: { "content-type": "image/png" } })),
      "https://pod.example/image",
      controller.signal,
    ),
  ).rejects.toThrow();
});
it("still reports the original failure when cancelling the body itself rejects", async () => {
  const denied = new Response(
    new ReadableStream({
      cancel() {
        throw Error("cancel");
      },
    }),
    { status: 403 },
  );
  await expect(
    readSlideImage(
      vi.fn(async () => denied),
      "https://pod.example/image",
    ),
  ).rejects.toThrow("Image unavailable");
  const overflow = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
      },
      cancel() {
        throw Error("cancel");
      },
    }),
    { headers: { "content-type": "image/png" } },
  );
  await expect(
    readSlideImage(
      vi.fn(async () => overflow),
      "https://pod.example/image",
    ),
  ).rejects.toThrow(RangeError);
});
