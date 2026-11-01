// AUTHORED-BY Codex GPT-6.1-Sol
import type { PreviewPaneProps, TypedView, TypedViewData } from "@jeswr/suite-ui";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { DrivePreview } from "../src/apps/drive/components/drive-preview";

const probes = vi.hoisted(() => ({
  pane: vi.fn<(props: PreviewPaneProps) => void>(),
  typed: vi.fn<(props: ComponentProps<typeof TypedView>) => void>(),
}));

vi.mock("@jeswr/suite-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/suite-ui")>();
  return {
    ...actual,
    // SSR cannot run PreviewPane's blob effect; inspect its caller-owned typed view.
    PreviewPane: (props: PreviewPaneProps) => {
      probes.pane(props);
      return props.source?.typedView ?? null;
    },
    TypedView: (props: ComponentProps<typeof TypedView>) => {
      probes.typed(props);
      return createElement(actual.TypedView, props);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const source = { name: "Private contact", blob: new Blob([], { type: "text/turtle" }) };
const data: TypedViewData = {
  types: ["http://www.w3.org/2006/vcard/ns#Individual"],
  properties: [],
  image: { src: "https://pod.example/private.jpg", alt: "Private image" },
  rawData: "Technical serialization",
};

test("passes a session-backed image resolver through the typed preview slot", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-image");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const session = { fetch: vi.fn<typeof fetch>(async () => new Response("private image")) };
  const html = renderToStaticMarkup(createElement(DrivePreview, { session, source, data }));
  const props = probes.typed.mock.lastCall?.[0];
  expect(props?.data).toBe(data);
  expect(props?.resolveImage).toBeTypeOf("function");
  expect(html).toContain("Loading image");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("Technical serialization");

  const controller = new AbortController();
  expect(await props?.resolveImage?.(data.image?.src as string, controller.signal)).toBe(
    "blob:private-image",
  );
  expect(session.fetch).toHaveBeenCalledExactlyOnceWith(data.image?.src, {
    signal: controller.signal,
  });
  expect(session.fetch.mock.contexts[0]).toBe(session);
  expect(create).toHaveBeenCalledOnce();
  controller.abort();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:private-image");
});

test("forwards preview metadata, recovery and the explicit advanced setting", () => {
  const onAction = vi.fn();
  const session = { fetch: vi.fn<typeof fetch>() };
  const state = { status: "ready" } as const;
  const input = { ...source, details: { Owner: "Alex" } };
  const html = renderToStaticMarkup(
    createElement(DrivePreview, {
      session,
      source: input,
      data,
      state,
      onAction,
      showTechnicalDetails: true,
    }),
  );
  expect(probes.pane.mock.lastCall?.[0]).toMatchObject({ source: input, state, onAction });
  expect(probes.typed.mock.lastCall?.[0]?.showTechnicalDetails).toBe(true);
  expect(html).toContain("Technical serialization");
  expect(session.fetch).not.toHaveBeenCalled();
});

test("leaves untyped and closed previews without a typed image read", () => {
  const session = { fetch: vi.fn<typeof fetch>() };
  renderToStaticMarkup(createElement(DrivePreview, { session, source }));
  expect(probes.pane.mock.lastCall?.[0]?.source).toMatchObject(source);
  expect(probes.typed).not.toHaveBeenCalled();
  renderToStaticMarkup(createElement(DrivePreview, { session, data }));
  expect(probes.pane.mock.lastCall?.[0]?.source).toBeUndefined();
  expect(probes.typed).not.toHaveBeenCalled();
  expect(session.fetch).not.toHaveBeenCalled();
});
