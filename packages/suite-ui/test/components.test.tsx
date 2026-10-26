// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { type SurfaceState, surfaceErrors } from "../src/components/content.js";
import {
  type AccessSummary,
  accessSummaryText,
  DetailsPane,
} from "../src/components/details-pane.js";
import { PodMeter } from "../src/components/pod-meter.js";
import { TypedView, type TypedViewData, typedViewRegistry } from "../src/components/typed-view.js";

afterEach(cleanup);
async function accessible(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}
const data: TypedViewData = {
  types: [],
  title: "A useful item",
  properties: [{ key: "description", label: "Description", values: ["Readable content"] }],
  rawData: "<https://pod.example/item> a <https://schema.org/Thing> .",
};
const grant = (webId: string, inherited = false) => ({
  agent: { kind: "webid" as const, webId },
  role: "viewer" as const,
  inherited,
  source: "https://pod.example/.acl",
});
const access: AccessSummary = {
  grants: [grant("https://me.example"), grant("https://mira.example", true)],
  canManage: true,
};

test.each([
  ...typedViewRegistry.keys(),
])("renders %s without visible identifiers, with semantic accessibility", async (type) => {
  const { container } = render(<TypedView data={{ ...data, types: [type] }} />);
  expect(container.textContent).not.toContain("http");
  expect(container.querySelector("pre")).toBeNull();
  await accessible(container);
});
test("generic labels and values are safe; Advanced mounts a keyboard disclosure only when enabled", async () => {
  const unsafe = {
    ...data,
    title: "https://pod.example/title",
    properties: [
      {
        key: "url",
        label: "http://vocab.example/name",
        values: ["A link https://secret.example/path"],
      },
    ],
  };
  const { container, rerender } = render(<TypedView data={unsafe} />);
  expect(container.textContent).not.toContain("http");
  rerender(<TypedView data={unsafe} showTechnicalDetails />);
  expect(screen.getByText("Show technical details").tagName).toBe("SUMMARY");
  fireEvent.click(screen.getByText("Show technical details"));
  expect(container.querySelector("pre")?.textContent).toContain("https://pod.example");
  await accessible(container);
  rerender(<TypedView data={unsafe} />);
  expect(container.querySelector("details")).toBeNull();
});
test("track artwork is optional, source is a named safe anchor", () => {
  const music = {
    ...data,
    types: ["https://schema.org/MusicRecording"],
    source: { label: "Spotify", url: "https://open.spotify.com/track/example" },
    image: { src: "/cover.svg", alt: "Album cover" },
  };
  const { container, rerender } = render(<TypedView data={music} />);
  expect(screen.getByRole("link", { name: "Open in Spotify" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
  expect(screen.getByRole("img").getAttribute("src")).toBe("/cover.svg");
  expect(container.textContent).not.toContain("http");
  rerender(
    <TypedView
      data={{
        ...music,
        source: { label: "Source", url: "javascript:alert(1)" },
        image: { src: "javascript:alert(1)", alt: "Cover" },
      }}
    />,
  );
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
});
test("a custom registry extends the built-in registry without mutations", () => {
  const registry = new Map(typedViewRegistry);
  registry.set("urn:custom", () => <p>Custom content</p>);
  render(<TypedView data={{ ...data, types: ["urn:custom"] }} registry={registry} />);
  expect(screen.getByText("Custom content")).toBeDefined();
  expect(typedViewRegistry.has("urn:custom")).toBe(false);
});
test("details summarize share.get, deduplicate people, exclude owner and gate Manage access", async () => {
  const manage = vi.fn();
  const { container, rerender } = render(
    <DetailsPane
      title="Quarterly plan"
      ownerId="https://me.example"
      access={{ ...access, grants: [...access.grants, grant("https://mira.example")] }}
      metadata={[{ label: "Location", value: <a href="/drive/my">My Drive</a> }]}
      actions={<button type="button">Download</button>}
      onManageAccess={manage}
    />,
  );
  expect(screen.getByText("Shared with 1 person")).toBeDefined();
  expect(screen.getByText("Includes access from the parent folder")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Manage access" }));
  expect(manage).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("http");
  await accessible(container);
  rerender(
    <DetailsPane title="Plan" access={{ grants: [], canManage: false }} onManageAccess={manage} />,
  );
  expect(screen.getByText("Only you")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Manage access" })).toBeNull();
});
test("public, signed-in, group and app grants cannot be misrepresented as private", () => {
  for (const [agent, copy] of [
    [{ kind: "public" }, "Anyone with the link"],
    [{ kind: "authenticated" }, "Anyone signed in"],
    [{ kind: "group", url: "https://group.example" }, "Shared with groups"],
    [{ kind: "app", clientId: "https://app.example" }, "Shared with apps"],
  ] as const) {
    expect(
      accessSummaryText({
        grants: [{ agent, role: "viewer", source: "private", inherited: false }],
        canManage: false,
      }),
    ).toBe(copy);
  }
});
test("details selection summaries, overflow people and access failures", async () => {
  const { container, rerender } = render(<DetailsPane />);
  expect(screen.getByText("Select an item to see its details")).toBeDefined();
  rerender(<DetailsPane selection={{ count: 3, totalSize: 3000 }} />);
  expect(screen.getByText("3 items selected · 3 KB")).toBeDefined();
  rerender(
    <DetailsPane
      title="Plan"
      access={{
        grants: Array.from({ length: 7 }, (_, i) => grant(`https://person.example/${i}`)),
        canManage: false,
      }}
    />,
  );
  expect(container.querySelectorAll(".suite-avatar")).toHaveLength(5);
  expect(screen.getByText("+2")).toBeDefined();
  rerender(<DetailsPane title="Plan" accessState={{ status: "error", category: "forbidden" }} />);
  expect(screen.getByRole("alert").textContent).toContain("You don't have access");
  await accessible(container);
});
test.each([
  undefined,
  0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
])("used-only usage never invents quota (%s)", async (quota) => {
  const { container } = render(
    <PodMeter used={3100000000} {...(quota !== undefined ? { quota } : {})} />,
  );
  expect(screen.getByText("3.1 GB used (no limit reported)")).toBeDefined();
  expect(screen.queryByRole("meter")).toBeNull();
  await accessible(container);
});
test("known quota uses native bounded meter and reports actual overage", async () => {
  const { container, rerender } = render(<PodMeter used={3100} quota={10000} />);
  expect(screen.getByRole("meter").getAttribute("value")).toBe("3100");
  expect(screen.getByText("3.1 KB of 10 KB used")).toBeDefined();
  rerender(<PodMeter used={12000} quota={10000} />);
  expect(screen.getByRole("meter").getAttribute("value")).toBe("10000");
  expect(screen.getByText("12 KB of 10 KB used")).toBeDefined();
  await accessible(container);
});
const states: SurfaceState[] = [
  { status: "loading" },
  { status: "empty" },
  { status: "empty", query: "missing" },
  ...Object.keys(surfaceErrors).map((category) => ({
    status: "error" as const,
    category: category as keyof typeof surfaceErrors,
  })),
];
test.each(
  states,
)("all async surfaces render accessible $status/$category states", async (state) => {
  const { container } = render(
    <>
      <TypedView state={state} />
      <DetailsPane state={state} />
      <PodMeter state={state} />
    </>,
  );
  expect(container.textContent).not.toContain("http");
  await accessible(container);
});
test("empty, filtered and retry actions run their supplied handler", () => {
  const action = vi.fn();
  const { rerender } = render(<TypedView state={{ status: "empty", onAction: action }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add an item" }));
  rerender(<TypedView state={{ status: "empty", query: "No match", onAction: action }} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  rerender(<TypedView state={{ status: "error", category: "unreachable", onRetry: action }} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(action).toHaveBeenCalledTimes(3);
});
