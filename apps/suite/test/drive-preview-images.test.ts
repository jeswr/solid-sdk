// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { createPreviewImageResolver } from "../src/apps/drive/lib/preview/image-resolver";

const image = "https://pod.example/private.jpg";
afterEach(() => vi.restoreAllMocks());

test("reads through the session fetch and owns the blob URL until abort", async () => {
  const ambient = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Anonymous read"));
  const blob = new Blob(["private image"], { type: "image/jpeg" });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-image");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const sessionFetch = vi.fn<typeof fetch>(async () => new Response(blob));
  const controller = new AbortController();
  const resolve = createPreviewImageResolver(sessionFetch);

  expect(await resolve(image, controller.signal)).toBe("blob:private-image");
  expect(sessionFetch).toHaveBeenCalledExactlyOnceWith(image, { signal: controller.signal });
  expect(ambient).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledOnce();
  const createdBlob = create.mock.calls[0]?.[0] as Blob;
  expect(await createdBlob.text()).toBe("private image");
  expect(createdBlob.type).toBe("image/jpeg");
  expect(revoke).not.toHaveBeenCalled();
  controller.abort();
  controller.abort();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:private-image");
});

test.each([401, 403, 404, 500])("HTTP %s never creates an image URL", async (status) => {
  const create = vi.spyOn(URL, "createObjectURL");
  const response = new Response("unavailable", { status });
  const body = vi.spyOn(response, "blob");
  const resolve = createPreviewImageResolver(async () => response);
  expect(await resolve(image, new AbortController().signal)).toBeUndefined();
  expect(body).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test("does not read when already aborted", async () => {
  const sessionFetch = vi.fn<typeof fetch>();
  const controller = new AbortController();
  controller.abort();
  expect(await createPreviewImageResolver(sessionFetch)(image, controller.signal)).toBeUndefined();
  expect(sessionFetch).not.toHaveBeenCalled();
});

test("ignores a response delivered after abort", async () => {
  const controller = new AbortController();
  const response = new Response("late image");
  const body = vi.spyOn(response, "blob");
  const resolve = createPreviewImageResolver(async () => {
    controller.abort();
    return response;
  });
  expect(await resolve(image, controller.signal)).toBeUndefined();
  expect(body).not.toHaveBeenCalled();
});

test("does not create a URL when a body finishes after abort", async () => {
  const create = vi.spyOn(URL, "createObjectURL");
  const controller = new AbortController();
  let finish = (_blob: Blob) => {};
  const response = new Response();
  const body = vi.spyOn(response, "blob").mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = createPreviewImageResolver(async () => response)(image, controller.signal);
  await vi.waitFor(() => expect(body).toHaveBeenCalledOnce());
  controller.abort();
  finish(new Blob(["late image"]));
  expect(await pending).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
});

test.each(["fetch", "body"])("propagates %s errors for TypedView's placeholder", async (stage) => {
  const create = vi.spyOn(URL, "createObjectURL");
  const error = new Error("Image read failed");
  const resolve = createPreviewImageResolver(async () => {
    if (stage === "fetch") throw error;
    const response = new Response();
    vi.spyOn(response, "blob").mockRejectedValue(error);
    return response;
  });
  await expect(resolve(image, new AbortController().signal)).rejects.toBe(error);
  expect(create).not.toHaveBeenCalled();
});

test("concurrent requests for the same image have independent URL lifetimes", async () => {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:second");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const resolve = createPreviewImageResolver(async () => new Response("image"));
  const first = new AbortController();
  const second = new AbortController();
  expect(await resolve(image, first.signal)).toBe("blob:first");
  expect(await resolve(image, second.signal)).toBe("blob:second");
  first.abort();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:first");
  second.abort();
  expect(revoke.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
  expect(create).toHaveBeenCalledTimes(2);
});
