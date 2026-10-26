// AUTHORED-BY Codex

import { fetchRdf } from "@jeswr/fetch-rdf";
import { afterEach, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { act, deferred, h, mount } from "./drive-ui-dom";

const { client } = vi.hoisted(() => ({ client: { read: vi.fn(), readRdf: vi.fn() } }));
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => ({ client }) }));
vi.mock("../src/apps/drive/state/ui", () => ({ useDriveActions: () => ({ download: vi.fn() }) }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));

import { PreviewBody } from "../src/apps/drive/components/preview";

const item: DriveItem = {
  url: "https://pod.example/drive/file.pdf",
  name: "file.pdf",
  kind: "file",
  contentType: "application/pdf",
};
const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
afterEach(() => {
  vi.clearAllMocks();
  client.read.mockReset();
  client.readRdf.mockReset();
  document.body.replaceChildren();
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
it("forces validated PDF bytes to application/pdf and sandboxes its iframe", async () => {
  client.read.mockResolvedValue(new Blob(["%PDF-1.7\nbytes"], { type: "text/html" }));
  const view = await mount(h(PreviewBody, { item }));
  const createdBlob = create.mock.calls[0]?.[0];
  expect(createdBlob).toBeInstanceOf(Blob);
  expect((createdBlob as Blob).type).toBe("application/pdf");
  expect(view.host.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
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
