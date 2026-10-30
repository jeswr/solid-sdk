// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { type SurfaceState, surfaceErrors } from "../src/components/content.js";
import type { ErrorRecovery } from "../src/components/error-state.js";
import {
  type AccessSummary,
  accessSummaryText,
  ItemDetails,
} from "../src/components/item-details.js";
import { PodMeter } from "../src/components/pod-meter.js";
import { TypedView, type TypedViewData, typedViewRegistry } from "../src/components/typed-view.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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
    <ItemDetails
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
    <ItemDetails title="Plan" access={{ grants: [], canManage: false }} onManageAccess={manage} />,
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
  const { container, rerender } = render(<ItemDetails />);
  expect(screen.getByText("Select an item to see its details")).toBeDefined();
  rerender(<ItemDetails selection={{ count: 3, totalSize: 3000 }} />);
  expect(screen.getByText("3 items selected · 3 KB")).toBeDefined();
  rerender(
    <ItemDetails
      title="Plan"
      access={{
        grants: Array.from({ length: 7 }, (_, i) => grant(`https://person.example/${i}`)),
        canManage: false,
      }}
    />,
  );
  expect(container.querySelectorAll(".suite-avatar")).toHaveLength(5);
  expect(screen.getByText("+2")).toBeDefined();
  rerender(<ItemDetails title="Plan" accessState={{ status: "error", category: "forbidden" }} />);
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
      <ItemDetails state={state} />
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
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(action).toHaveBeenCalledTimes(3);
});

const errorCategories = Object.keys(surfaceErrors) as (keyof typeof surfaceErrors)[];
const contentSurfaces = [TypedView, ItemDetails, PodMeter];
test.each(contentSurfaces)("%s preserves legacy recovery callbacks for every category", (View) => {
  const onRetry = vi.fn();
  const { rerender } = render(<View />);
  for (const category of errorCategories) {
    rerender(<View state={{ status: "error", category, onRetry }} />);
    fireEvent.click(
      screen.getByRole("button", { name: category === "reauth" ? "Sign in" : "Retry" }),
    );
  }
  expect(onRetry).toHaveBeenCalledTimes(errorCategories.length);
});
const recoveryCases: [keyof typeof surfaceErrors, ErrorRecovery, string[]][] = [
  ["reauth", { signIn: vi.fn<() => void>() }, ["Sign in"]],
  [
    "forbidden",
    { requestAccess: vi.fn<() => void>(), switchAccount: vi.fn<() => void>() },
    ["Request access", "Switch account"],
  ],
  ["not-found", { goToParent: "/drive", home: "/" }, ["Go to parent", "Home"]],
  ["conflict", { resolveConflict: vi.fn<() => void>() }, ["Review changes"]],
  ["quota", { manageStorage: vi.fn<() => void>() }, ["Manage storage"]],
  ["offline", { retry: vi.fn<() => void>() }, ["Retry"]],
  [
    "unreachable",
    { retry: vi.fn<() => void>(), showSavedCopies: vi.fn<() => void>() },
    ["Retry", "Show saved copies"],
  ],
  ["unknown", { reload: vi.fn<() => void>(), report: "/report" }, ["Reload", "Report a problem"]],
];
test.each(contentSurfaces)("%s forwards category-specific recovery actions", (View) => {
  const { rerender } = render(<View />);
  for (const [category, actions, labels] of recoveryCases) {
    for (const handler of Object.values(actions))
      if (typeof handler === "function") vi.mocked(handler).mockClear();
    rerender(<View state={{ status: "error", category, actions, accessRequests: true }} />);
    expect(
      screen
        .queryAllByRole("button")
        .concat(screen.queryAllByRole("link"))
        .map((el) => el.textContent)
        .sort(),
    ).toEqual([...labels].sort());
    for (const button of screen.queryAllByRole("button")) fireEvent.click(button);
    for (const handler of Object.values(actions))
      if (typeof handler === "function") expect(handler).toHaveBeenCalledOnce();
    expect(
      screen
        .queryAllByRole("link")
        .map((link) => link.getAttribute("href"))
        .sort(),
    ).toEqual(
      Object.values(actions)
        .filter((action) => typeof action === "string")
        .sort(),
    );
  }
});
test("content access recovery requires the capability, including ItemDetails.accessState", () => {
  const requestAccess = vi.fn();
  const switchAccount = vi.fn();
  const accessState: SurfaceState = {
    status: "error",
    category: "forbidden",
    actions: { requestAccess, switchAccount },
  };
  const { rerender } = render(<ItemDetails title="Plan" accessState={accessState} />);
  expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  expect(switchAccount).toHaveBeenCalledOnce();
  rerender(<ItemDetails title="Plan" accessState={{ ...accessState, accessRequests: true }} />);
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
  expect(requestAccess).toHaveBeenCalledOnce();
});
test.each([
  "reauth",
  "unreachable",
] as const)("explicit %s recovery overrides the legacy callback", (category) => {
  const onRetry = vi.fn();
  const action = vi.fn();
  render(
    <TypedView
      state={{
        status: "error",
        category,
        onRetry,
        actions: category === "reauth" ? { signIn: action } : { retry: action },
      }}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: category === "reauth" ? "Sign in" : "Retry" }),
  );
  expect(action).toHaveBeenCalledOnce();
  expect(onRetry).not.toHaveBeenCalled();
});
test("content retries wait again for a new error with the same delay", async () => {
  vi.useFakeTimers();
  const retry = vi.fn();
  const state: SurfaceState = {
    status: "error",
    category: "unreachable",
    retryAfterMs: 8000,
    actions: { retry },
  };
  const { rerender, unmount } = render(<TypedView state={state} />);
  const button = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(8000));
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledOnce();
  rerender(<TypedView state={{ ...state }} />);
  expect(button.disabled).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(button.disabled).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
