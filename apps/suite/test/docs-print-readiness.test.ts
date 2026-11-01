// @vitest-environment jsdom
// AUTHORED-BY Codex
import { afterEach, expect, it, vi } from "vitest";
import { printDocument } from "../src/apps/docs/editor/print-document";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function page(...alts: string[]) {
  const root = document.createElement("article");
  const images = alts.map((alt) => {
    const image = document.createElement("img");
    image.alt = alt;
    root.append(image);
    return image;
  });
  document.body.append(root);
  return { root, images };
}

it("prints documents without images immediately", async () => {
  const { root } = page();
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  await printDocument(root);
  expect(print).toHaveBeenCalledOnce();
});

it("waits for every image, including a private image with no src and an unfinished decode", async () => {
  const { root, images } = page("Private", "Remote");
  const [privateImage, remote] = images as [HTMLImageElement, HTMLImageElement];
  remote.src = "https://example.org/remote.png";
  let decoded!: () => void;
  remote.decode = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        decoded = resolve;
      }),
  );
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const task = printDocument(root);
  expect(remote.decode).toHaveBeenCalledOnce();
  expect(print).not.toHaveBeenCalled();
  privateImage.src = "blob:private";
  privateImage.dispatchEvent(new Event("load"));
  await Promise.resolve();
  expect(print).not.toHaveBeenCalled();
  decoded();
  await task;
  expect(print).toHaveBeenCalledOnce();
  expect(images.every((image) => !image.hidden)).toBe(true);
});

it("prints visible alt text for decode failures and restores the live editor afterward", async () => {
  const { root, images } = page("Project diagram");
  const image = images[0] as HTMLImageElement;
  image.src = "blob:broken";
  image.decode = vi.fn().mockRejectedValue(new Error("Invalid image"));
  vi.spyOn(window, "print").mockImplementation(() => {
    expect(image.hidden).toBe(true);
    expect(root.textContent).toBe("Project diagram");
  });
  await printDocument(root);
  expect(image.hidden).toBe(false);
  expect(root.textContent).toBe("");
  expect(root.querySelector("img")).toBe(image);
});

it("uses cached load results and placeholders for already broken images", async () => {
  const { root, images } = page("Loaded", "Broken");
  images.forEach((image, index) => {
    image.src = `blob:${index}`;
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "naturalWidth", { value: index === 0 ? 100 : 0 });
  });
  vi.spyOn(window, "print").mockImplementation(() => {
    expect(images[0]?.hidden).toBe(false);
    expect(images[1]?.hidden).toBe(true);
    expect(root.textContent).toBe("Broken");
  });
  await printDocument(root);
});

it.each([
  "error event",
  "private fetch failure",
])("prints after an %s with a visible fallback", async (failure) => {
  const { root, images } = page("");
  const image = images[0] as HTMLImageElement;
  const print = vi.spyOn(window, "print").mockImplementation(() => {
    expect(image.hidden).toBe(true);
    expect(root.textContent).toBe("Image unavailable");
  });
  const task = printDocument(root);
  if (failure === "error event") image.dispatchEvent(new Event("error"));
  else image.dataset.docsImageState = "error";
  await task;
  expect(print).toHaveBeenCalledOnce();
});

it("bounds pending fetches and decodes by one timeout and prints alt-text placeholders", async () => {
  vi.useFakeTimers();
  const { root, images } = page("Slow fetch", "Slow decode");
  const image = images[1] as HTMLImageElement;
  image.src = "blob:slow";
  image.decode = vi.fn(() => new Promise<void>(() => {}));
  const print = vi.spyOn(window, "print").mockImplementation(() => {
    expect(images.every((image) => image.hidden)).toBe(true);
    expect(root.textContent).toBe("Slow fetchSlow decode");
  });
  const task = printDocument(root);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(print).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await task;
  expect(print).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  true,
  false,
])("cancels image waits without printing (already aborted=%s)", async (alreadyAborted) => {
  vi.useFakeTimers();
  const { root, images } = page("Pending");
  const abort = new AbortController();
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  if (alreadyAborted) abort.abort();
  const task = printDocument(root, abort.signal);
  abort.abort();
  await task;
  images[0]?.dispatchEvent(new Event("load"));
  expect(print).not.toHaveBeenCalled();
  expect(root.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});

it("restores placeholders and hidden state if opening the print dialog fails", async () => {
  const { root, images } = page("Unavailable");
  const image = images[0] as HTMLImageElement;
  image.hidden = true;
  image.dataset.docsImageState = "error";
  vi.spyOn(window, "print").mockImplementation(() => {
    throw new Error("Printing failed");
  });
  await expect(printDocument(root)).rejects.toThrow("Printing failed");
  expect(image.hidden).toBe(true);
  expect(root.textContent).toBe("");
});
