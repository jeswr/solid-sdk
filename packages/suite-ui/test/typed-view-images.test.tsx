// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TypedView, type TypedViewData } from "../src/components/typed-view.js";

const imageData = (type: string, src = "https://pod.example/private.jpg"): TypedViewData => ({
  types: [type],
  properties: [],
  image: { src, alt: "Artwork" },
});
const types = [
  "http://www.w3.org/2006/vcard/ns#Individual",
  "https://schema.org/MusicRecording",
  "https://schema.org/Photograph",
];

test.each(types)("%s resolves private images before mounting an img", async (type) => {
  let finish = (_url: string | undefined) => {};
  const resolveImage = vi.fn(
    (_url: string, _signal: AbortSignal) =>
      new Promise<string | undefined>((resolve) => {
        finish = resolve;
      }),
  );
  render(<TypedView data={imageData(type)} resolveImage={resolveImage} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByLabelText("Loading image")).toBeDefined();
  expect(resolveImage).toHaveBeenCalledWith(
    "https://pod.example/private.jpg",
    expect.any(AbortSignal),
  );
  await act(async () => finish("blob:private-image"));
  expect(screen.getByRole("img").getAttribute("src")).toBe("blob:private-image");
  fireEvent.error(screen.getByRole("img"));
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByLabelText("Image unavailable")).toBeDefined();
});

test.each(types)("%s accepts caller-owned blob images without changing link policy", (type) => {
  const resolveImage = vi.fn();
  render(
    <TypedView
      resolveImage={resolveImage}
      data={{
        ...imageData(type, "blob:caller-owned"),
        source: { label: "Source", url: "blob:secret" },
      }}
    />,
  );
  expect(screen.getByRole("img").getAttribute("src")).toBe("blob:caller-owned");
  expect(screen.queryByRole("link")).toBeNull();
  expect(resolveImage).not.toHaveBeenCalled();
});

test("revisiting an image URL starts a fresh read and resolver replacement aborts it", async () => {
  const signals: AbortSignal[] = [];
  const resolveImage = vi.fn(async (_url: string, signal: AbortSignal) => {
    signals.push(signal);
    return `blob:read-${signals.length}`;
  });
  const first = imageData(types[0] as string);
  const { rerender } = render(<TypedView data={first} resolveImage={resolveImage} />);
  await screen.findByRole("img");
  rerender(
    <TypedView
      data={imageData(types[0] as string, "https://pod.example/other.jpg")}
      resolveImage={resolveImage}
    />,
  );
  expect(screen.queryByRole("img")).toBeNull();
  await screen.findByRole("img");
  rerender(<TypedView data={first} resolveImage={resolveImage} />);
  expect(screen.queryByRole("img")).toBeNull();
  await screen.findByRole("img");
  expect(screen.getByRole("img").getAttribute("src")).toBe("blob:read-3");
  rerender(<TypedView data={first} resolveImage={async () => undefined} />);
  expect(signals[2]?.aborted).toBe(true);
  await screen.findByLabelText("Image unavailable");
});

test.each([
  "javascript:alert(1)",
  "data:image/png;base64,AAAA",
  "//other.example/image",
  "https://user:pass@pod.example/image",
])("rejects unsafe image input %s before calling the resolver", (src) => {
  const resolveImage = vi.fn();
  render(<TypedView data={imageData(types[0] as string, src)} resolveImage={resolveImage} />);
  expect(resolveImage).not.toHaveBeenCalled();
  expect(screen.queryByRole("img")).toBeNull();
});

test.each([
  undefined,
  "javascript:alert(1)",
  "data:image/png;base64,AAAA",
  new Error("denied"),
])("keeps a placeholder after failed or unsafe resolution: %s", async (result) => {
  const resolveImage = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  render(<TypedView data={imageData(types[0] as string)} resolveImage={resolveImage} />);
  await screen.findByLabelText("Image unavailable");
  expect(screen.queryByRole("img")).toBeNull();
});

test("aborts replaced and unmounted image reads and ignores late results", async () => {
  const pending: { signal: AbortSignal; finish: (url: string) => void }[] = [];
  const resolveImage = vi.fn(
    (_url: string, signal: AbortSignal) =>
      new Promise<string>((finish) => pending.push({ signal, finish })),
  );
  const { rerender, unmount } = render(
    <TypedView data={imageData(types[0] as string)} resolveImage={resolveImage} />,
  );
  rerender(
    <TypedView
      data={imageData(types[0] as string, "https://pod.example/new.jpg")}
      resolveImage={resolveImage}
    />,
  );
  expect(pending[0]?.signal.aborted).toBe(true);
  await act(async () => pending[0]?.finish("blob:stale"));
  expect(screen.queryByRole("img")).toBeNull();
  await act(async () => pending[1]?.finish("blob:latest"));
  expect(screen.getByRole("img").getAttribute("src")).toBe("blob:latest");
  unmount();
  expect(pending[1]?.signal.aborted).toBe(true);
});
