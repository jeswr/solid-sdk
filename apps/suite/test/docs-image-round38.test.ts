// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";

afterEach(() => vi.unstubAllGlobals());

it.each([
  "network",
  "http",
  "content",
])("round38 failed private images retry on reconnect after a %s failure", async (failure) => {
  const createObjectURL = vi.fn(() => "blob:reconnected");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  let online = false;
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetchImage = vi.fn<typeof fetch>(async () => {
    if (online) return response;
    if (failure === "network") throw new Error("Offline");
    return new Response("unavailable", {
      status: failure === "http" ? 503 : 200,
      headers: { "content-type": "text/plain" },
    });
  });
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: baseExtensions(fetchImage),
    content: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "https://pod.test/image.png", alt: "Photo" } }],
    },
  });
  try {
    const image = editor.view.dom.querySelector("img") as HTMLImageElement;
    await vi.waitFor(() => expect(image.alt).toBe("Image unavailable: Photo"));
    const initialRequests = fetchImage.mock.calls.length;
    online = true;
    window.dispatchEvent(new Event("online"));
    expect(fetchImage).toHaveBeenCalledTimes(initialRequests + 1);
    expect(image.dataset.docsImageState).toBe("loading");
    expect(image.alt).toBe("Photo");
    window.dispatchEvent(new Event("online"));
    expect(fetchImage).toHaveBeenCalledTimes(initialRequests + 1);
    resolve(new Response("pixels", { headers: { "content-type": "image/png" } }));
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("blob:reconnected"));
    expect(image.dataset.docsImageState).toBe("loaded");
    expect(editor.getJSON().content?.[0]?.attrs?.src).toBe("https://pod.test/image.png");
    window.dispatchEvent(new Event("online"));
    expect(fetchImage).toHaveBeenCalledTimes(initialRequests + 1);
  } finally {
    editor.destroy();
  }
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:reconnected");
  const requests = fetchImage.mock.calls.length;
  window.dispatchEvent(new Event("online"));
  expect(fetchImage).toHaveBeenCalledTimes(requests);
});
