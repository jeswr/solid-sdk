// AUTHORED-BY Codex

import { fetchRdf } from "@jeswr/fetch-rdf";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const { client, ui } = vi.hoisted(() => ({
  client: {
    read: vi.fn(),
    readRdf: vi.fn(),
    stat: vi.fn().mockRejectedValue(new Error("Metadata unavailable")),
  },
  ui: vi.fn(),
}));
const listeners = new Set<() => void>();
const changes = {
  subscribe: (_url: string, listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => ({
    client,
    changes,
    driveRoot: "https://pod.example/drive/",
    session: { webId: "https://pod.example/profile#me", storageUrl: "https://pod.example/" },
  }),
}));
vi.mock("../src/apps/drive/state/ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useDriveActions: () => ({ download: vi.fn(), starred: new Set() }),
  useDriveUi: ui,
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));

vi.mock("next/navigation", () => ({
  usePathname: () => "/drive/my",
  useRouter: () => ({ push: vi.fn() }),
}));

import { DetailsPane } from "../src/apps/drive/components/details";
import { PreviewBody, PreviewDialog } from "../src/apps/drive/components/preview";
import { SuiteFrame } from "../src/components/interim-shell/suite-frame";

const item: DriveItem = {
  url: "https://pod.example/drive/file.pdf",
  name: "file.pdf",
  kind: "file",
  contentType: "application/pdf",
};
const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

it.each([
  "Download",
  "Star",
  "Details",
  "Close",
  "link",
])("Escape dismisses preview from %s", async (label) => {
  client.read.mockResolvedValue(new Blob(["plain"], { type: "text/plain" }));
  const setPreview = vi.fn();
  ui.mockReturnValue({
    preview: { items: [{ ...item, contentType: "text/plain" }], index: 0 },
    setPreview,
  });
  const view = await mount(h(PreviewDialog));
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  let control = dialog.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (label === "link") {
    control = document.createElement("a");
    control.setAttribute("href", "#file");
    control.textContent = "File link";
    dialog.append(control);
  }
  if (!control) throw new Error("Missing preview control");
  await act(async () => {
    control.focus();
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(setPreview).toHaveBeenCalledWith(undefined);
  await view.unmount();
});

it("preview shortcuts preserve native audio control keys", async () => {
  client.read.mockResolvedValue(new Blob(["audio"], { type: "audio/mpeg" }));
  const setPreview = vi.fn();
  ui.mockReturnValue({
    preview: { items: [{ ...item, contentType: "audio/mpeg" }, item], index: 0 },
    setPreview,
  });
  const view = await mount(h(PreviewDialog));
  const audio = document.querySelector("audio") as HTMLAudioElement;
  expect(audio).not.toBeNull();
  await act(async () => audio.focus());
  const right = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    audio.dispatchEvent(right);
  });
  expect(right.defaultPrevented).toBe(false);
  expect(setPreview).not.toHaveBeenCalled();
  await view.unmount();
});

it.each([
  "video",
  "input",
  "select",
  "textarea",
  "contenteditable",
  "combobox",
  "listbox",
  "menu",
])("preview leaves ArrowLeft, ArrowRight and Escape to an interactive %s", async (kind) => {
  client.read.mockResolvedValue(new Blob(["plain"], { type: "text/plain" }));
  const setPreview = vi.fn();
  ui.mockReturnValue({
    preview: { items: [item, { ...item, contentType: "text/plain" }, item], index: 1 },
    setPreview,
  });
  const view = await mount(h(PreviewDialog));
  const tag = ["contenteditable", "combobox", "listbox", "menu"].includes(kind)
    ? "div"
    : kind === "link"
      ? "a"
      : kind;
  const control = document.createElement(tag);
  control.tabIndex = 0;
  if (kind === "contenteditable") control.setAttribute("contenteditable", "true");
  if (["combobox", "listbox", "menu"].includes(kind)) control.setAttribute("role", kind);
  if (kind === "link") control.setAttribute("href", "#native");
  const nested = document.createElement("span");
  control.append(nested);
  document.querySelector(".drv-preview-body")?.append(control);
  await act(async () => control.focus());
  for (const key of ["ArrowLeft", "ArrowRight", "Escape"]) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => {
      nested.dispatchEvent(event);
    });
    // Radix's Escape cancellation keeps the modal open; seeking/editing keys
    // must reach the control without cancelling its native default action.
    if (key !== "Escape") expect(event.defaultPrevented).toBe(false);
  }
  expect(setPreview).not.toHaveBeenCalled();
  await view.unmount();
});

it.each([
  "slider",
  "spinbutton",
  "button",
  "link",
])("preview keeps arrow protection but dismisses on Escape from %s", async (kind) => {
  client.read.mockResolvedValue(new Blob(["plain"], { type: "text/plain" }));
  const setPreview = vi.fn();
  ui.mockReturnValue({
    preview: { items: [item, { ...item, contentType: "text/plain" }, item], index: 1 },
    setPreview,
  });
  const view = await mount(h(PreviewDialog));
  const control = document.createElement(
    kind === "button" ? "button" : kind === "link" ? "a" : "div",
  );
  control.tabIndex = 0;
  if (kind === "link") control.setAttribute("href", "#file");
  if (kind === "slider" || kind === "spinbutton") control.setAttribute("role", kind);
  document.querySelector(".drv-preview-body")?.append(control);
  await act(async () => control.focus());
  for (const key of ["ArrowLeft", "ArrowRight"]) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => {
      control.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(setPreview).not.toHaveBeenCalled();
  await act(async () => {
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(setPreview).toHaveBeenCalledWith(undefined);
  await view.unmount();
});

it.each(["dialog", "details"])("Escape respects an open native %s", async (kind) => {
  client.read.mockResolvedValue(new Blob(["plain"], { type: "text/plain" }));
  const setPreview = vi.fn();
  ui.mockReturnValue({
    preview: { items: [{ ...item, contentType: "text/plain" }], index: 0 },
    setPreview,
  });
  const view = await mount(h(PreviewDialog));
  const native = document.createElement(kind);
  native.setAttribute("open", "");
  const control = document.createElement("button");
  native.append(control);
  document.querySelector(".drv-preview-body")?.append(native);
  await act(async () => {
    control.focus();
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  if (kind === "dialog") expect(setPreview).not.toHaveBeenCalled();
  else expect(setPreview).toHaveBeenCalledWith(undefined);
  await view.unmount();
});

it("preview arrows navigate from the viewer and Escape still closes it", async () => {
  client.read.mockResolvedValue(new Blob(["plain"], { type: "text/plain" }));
  const setPreview = vi.fn();
  const preview = { items: [item, { ...item, contentType: "text/plain" }, item], index: 1 };
  ui.mockReturnValue({ preview, setPreview });
  const view = await mount(h(PreviewDialog));
  const content = document.querySelector('[role="dialog"]') as HTMLElement;
  for (const key of ["ArrowLeft", "ArrowRight", "Escape"]) {
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }
  expect(setPreview).toHaveBeenCalledWith({ ...preview, index: 0 });
  expect(setPreview).toHaveBeenCalledWith({ ...preview, index: 2 });
  expect(setPreview).toHaveBeenCalledWith(undefined);
  await view.unmount();
});

it("preview close focuses the listing when the previewed row has disappeared", async () => {
  client.read.mockResolvedValue(new Blob(["%PDF-1.7"]));
  function Viewer({ hasRow }: { hasRow: boolean }) {
    const [preview, setPreview] = useState<{ items: DriveItem[]; index: number } | undefined>({
      items: [item],
      index: 0,
    });
    ui.mockReturnValue({ preview, setPreview });
    return h(
      "div",
      null,
      h(
        "div",
        { "data-drive-listing": "", tabIndex: 0 },
        hasRow ? h("div", { "data-url": item.url, tabIndex: -1 }, item.name) : null,
      ),
      h(PreviewDialog),
    );
  }
  const view = await mount(h(Viewer, { hasRow: true }));
  await view.render(h(Viewer, { hasRow: false }));
  await click(document.querySelector('[aria-label="Close"]') as Element);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.activeElement).toBe(view.host.querySelector("[data-drive-listing]"));
  await view.unmount();
});

it("renders a bounded CSV preview with a truncation notice for a comma-only megabyte", async () => {
  client.read.mockResolvedValue(new Blob([",".repeat(1024 * 1024)], { type: "text/csv" }));
  const view = await mount(h(PreviewBody, { item: { ...item, contentType: "text/csv" } }));
  expect(view.host.querySelectorAll("th").length).toBeLessThanOrEqual(100);
  expect(view.host.textContent).toMatch(/truncated/i);
  await view.unmount();
});
afterEach(() => {
  vi.clearAllMocks();
  client.read.mockReset();
  client.readRdf.mockReset();
});

it("rejects HTML advertised as PDF before creating a blob URL", async () => {
  client.read.mockResolvedValue(
    new Blob(["<script>parent.pwned=true</script>"], { type: "text/html" }),
  );
  const view = await mount(h(PreviewBody, { item }));
  expect(view.host.textContent).toContain("Can't preview this file");
  expect(view.host.querySelector("iframe")).toBeNull();
  expect(create).not.toHaveBeenCalled();
  await view.unmount();
});
it("round 55: valid PDF uses the native viewer without Chromium's sandbox navigation block", async () => {
  client.read.mockResolvedValue(new Blob(["%PDF-1.7\nbytes"], { type: "text/html" }));
  const view = await mount(h(PreviewBody, { item }));
  const createdBlob = create.mock.calls[0]?.[0];
  expect(createdBlob).toBeInstanceOf(Blob);
  expect((createdBlob as Blob).type).toBe("application/pdf");
  expect(view.host.querySelector("iframe")?.getAttribute("sandbox")).toBeNull();
  await view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:preview");
});
it("rejects non-image GET types for image listings and renders SVG only as img", async () => {
  const image = { ...item, contentType: "image/svg+xml", name: "image.svg" };
  client.read.mockResolvedValueOnce(new Blob(["<html>"], { type: "text/html" }));
  const view = await mount(h(PreviewBody, { item: image }));
  expect(view.host.textContent).toContain("Can't preview this file");
  client.read.mockResolvedValueOnce(new Blob(["<svg/>"], { type: "image/svg+xml" }));
  await view.render(h(PreviewBody, { item: { ...image, url: `${image.url}2` } }));
  expect(view.host.querySelector("img")).not.toBeNull();
  expect(view.host.querySelector("iframe")).toBeNull();
  await view.unmount();
});
it("renders RDF predicates named __proto__ and constructor without inherited labels", async () => {
  const { dataset } = await fetchRdf(item.url, {
    fetch: async () =>
      new Response(
        '<urn:item> <https://vocab.example/__proto__> "Safe"; <https://vocab.example/constructor> "Also safe".',
        { headers: { "content-type": "text/turtle" } },
      ),
  });
  client.readRdf.mockResolvedValue({ dataset });
  const view = await mount(h(PreviewBody, { item: { ...item, contentType: "text/turtle" } }));
  expect(view.host.textContent).toContain("Safe");
  expect([...view.host.querySelectorAll("dt")].map((e) => e.textContent)).toEqual([
    "  proto  ",
    "Constructor",
  ]);
  await view.unmount();
});
it("releases a blob from a read that completes after closing preview", async () => {
  const read = deferred<Blob>();
  client.read.mockReturnValue(read.promise);
  const view = await mount(h(PreviewBody, { item: { ...item, contentType: "image/png" } }));
  await view.unmount();
  await act(async () => read.resolve(new Blob(["image"], { type: "image/png" })));
  expect(create.mock.calls.length).toBe(revoke.mock.calls.length);
});

it("renders malformed percent-encoded RDF contact IRIs without throwing", async () => {
  const { dataset } = await fetchRdf(item.url, {
    fetch: async () =>
      new Response(
        "<urn:item> <http://www.w3.org/2006/vcard/ns#hasEmail> <mailto:alice%FF@example.org>; <http://www.w3.org/2006/vcard/ns#hasTelephone> <tel:%FF>; <urn:valid> <mailto:alice%40example.org>.",
        { headers: { "content-type": "text/turtle" } },
      ),
  });
  client.readRdf.mockResolvedValue({ dataset });
  const view = await mount(h(PreviewBody, { item: { ...item, contentType: "text/turtle" } }));
  expect(view.host.textContent).toContain("mailto:alice%FF@example.org");
  expect(view.host.textContent).toContain("tel:%FF");
  expect(view.host.textContent).toContain("alice@example.org");
  await view.unmount();
});

it("keeps desktop preview Details inside the modal and exposes its keyboard controls", async () => {
  client.read.mockResolvedValue(new Blob(["plain text"], { type: "text/plain" }));
  function Viewer() {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [detailsItems, setDetailsItems] = useState<DriveItem[]>([]);
    ui.mockReturnValue({
      preview: { items: [{ ...item, contentType: "text/plain" }], index: 0 },
      setPreview: vi.fn(),
      detailsOpen,
      setDetailsOpen,
      detailsItems,
      setDetailsItems,
    });
    return h(SuiteFrame, {
      app: "drive",
      sidebar: "Files",
      details: detailsOpen ? h(DetailsPane, { onClose: () => setDetailsOpen(false) }) : undefined,
      children: h(PreviewDialog),
    });
  }
  const view = await mount(h(Viewer));
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
  const trigger = dialog.querySelector<HTMLElement>('[aria-label="Details"]') as HTMLElement;
  await act(async () => trigger.focus());
  await click(trigger);
  const pane = dialog.querySelector<HTMLElement>('[aria-label="Details"]:not(button)');
  expect(pane).not.toBeNull();
  if (!pane) throw new Error("Missing preview Details");
  expect(pane.closest('[aria-hidden="true"]')).toBeNull();
  const technical = [...pane.querySelectorAll<HTMLButtonElement>("button")].find(
    (e) => e.textContent === "Show technical details",
  );
  if (!technical) throw new Error("Missing technical details control");
  await act(async () => technical.focus());
  expect(document.activeElement === technical).toBe(true);
  await click(technical);
  expect(pane?.textContent).toContain(item.url);
  await click(pane.querySelector('[aria-label="Close details"]') as Element);
  expect(dialog.querySelector('[aria-label="Close details"]')).toBeNull();
  expect(document.activeElement === trigger).toBe(true);
  expect(view.host.querySelector(".ish-details")).toBeNull();
  await view.unmount();
});

it("round 56: unrelated uploads preserve a video player and its playback position", async () => {
  const videoItem = {
    ...item,
    name: "video.mp4",
    url: "https://pod.example/drive/video.mp4",
    contentType: "video/mp4",
    etag: '"video-v1"',
  };
  client.stat.mockResolvedValue(videoItem);
  client.read.mockResolvedValue(new Blob(["video"], { type: "video/mp4" }));
  ui.mockReturnValue({ preview: { items: [videoItem], index: 0 }, setPreview: vi.fn() });
  const view = await mount(h(PreviewDialog));
  const video = document.querySelector("video") as HTMLVideoElement;
  expect(video).not.toBeNull();
  video.currentTime = 42;
  const metadata = deferred<DriveItem>();
  client.stat.mockReturnValueOnce(metadata.promise);
  await act(async () => {
    for (const listener of listeners) listener();
  });
  expect(document.querySelector("video")).toBe(video);
  await act(async () => metadata.resolve(videoItem));
  expect(document.querySelector("video")).toBe(video);
  expect(video.currentTime).toBe(42);
  expect(client.read).toHaveBeenCalledTimes(1);
  client.stat.mockResolvedValue({ ...videoItem, etag: '"video-v2"' });
  await act(async () => {
    for (const listener of listeners) listener();
  });
  expect(client.read).toHaveBeenCalledTimes(2);
  await view.unmount();
  client.stat.mockRejectedValue(new Error("Metadata unavailable"));
});
