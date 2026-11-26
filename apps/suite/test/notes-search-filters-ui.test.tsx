// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { noteSearchHref, parseNoteSearch } from "../src/apps/notes/lib/search-filters";
import { taskListHtml } from "../src/apps/notes/lib/ui/capture";
import { act, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, within } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const { default: userEvent } = requireUi(
  "@testing-library/user-event",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/user-event");
const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  href: "/notes/search",
  listeners: new Set<() => void>(),
  push: vi.fn(),
}));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/notes/search",
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (listener) => {
            mocks.listeners.add(listener);
            return () => {
              mocks.listeners.delete(listener);
            };
          },
          () => mocks.href.split("?")[1] ?? "",
        ),
      ),
    useRouter: () => ({ push: mocks.push }),
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: ComponentProps<"a">) =>
    h(
      "a",
      {
        ...props,
        href,
        onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          event.preventDefault();
          mocks.push(href);
        },
      },
      children,
    ),
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({
  useNotesContext: () => mocks.context,
  NotesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: mocks.context.session }),
}));
vi.mock("../src/apps/notes/state/reminders", () => ({ useNoteReminders: () => {} }));
vi.mock("../src/components/interim-shell/suite-frame", async (original) => {
  const actual = await original<typeof import("../src/components/interim-shell/suite-frame")>();
  return {
    ...actual,
    SuiteFrame: ({ children, sidebar, search }: ComponentProps<typeof actual.SuiteFrame>) =>
      h("div", null, sidebar, search && h(actual.SearchBox, { search }), children),
  };
});
const { NotesApp } = await import("../src/apps/notes/components/notes-app");
const root = "https://pod.example/";
const bob = `${root}bob#me`;
const label = "Ideas & plans / 家";
const resource = { loading: false, data: [], error: undefined };
const body = `${taskListHtml([{ text: "Sunflowers", checked: false }])}<a href="https://example.org/">Website</a>`;
function note(id: string, fields: Partial<StoredNote> = {}): StoredNote {
  return {
    url: `${root}notes/${id}.ttl`,
    title: id,
    body: "<p>Sunflowers</p>",
    labels: [],
    location: "active",
    format: "text/html",
    revisions: [],
    etag: '"v1"',
    ...fields,
  };
}
const garden = note("Garden", { labels: [label], body });
const archived = note("Archived garden", {
  labels: [label],
  body,
  location: "archived",
  reminder: "2026-11-12T08:00:00Z",
});
const red = note("Red garden", { labels: [label], body });
const image = note("Image", { body: `<img src="${root}notes/media/a.png">` });
const trash = note("Trashed garden", { labels: [label], body, location: "trashed" });
beforeEach(() => {
  mocks.href = "/notes/search";
  mocks.push.mockReset().mockImplementation((href: string) => {
    mocks.href = href;
    for (const listener of mocks.listeners) listener();
  });
  mocks.context = {
    notes: [garden, archived, red, image, trash],
    labels: [label],
    sharedNotes: { [garden.url]: true, [archived.url]: true, [red.url]: true, [trash.url]: true },
    collaborators: {
      [garden.url]: [bob],
      [archived.url]: [bob],
      [red.url]: [bob],
      [trash.url]: [`${root}trash#me`],
    },
    prefs: {
      pinned: [garden.url],
      colours: {
        [garden.url]: "blue",
        [archived.url]: "blue",
        [red.url]: "red",
        [trash.url]: "purple",
      },
      view: "grid",
    },
    session: {
      webId: `${root}#me`,
      storageUrl: root,
      fetch: vi.fn(async () => new Response("", { status: 404 })),
    },
    active: resource,
    archived: resource,
    trashed: resource,
    store: {
      containers: { active: `${root}notes/` },
      purgeTrash: vi.fn(async () => ({ deleted: [], failed: [] })),
    },
    refresh: vi.fn(),
    pin: vi.fn(),
    colour: vi.fn(),
    openNote: vi.fn(),
    openShare: vi.fn(),
    mutations: {},
  };
});
afterEach(cleanup);
const app = () => h(NotesApp, { children: null });
const titles = () =>
  screen
    .queryAllByRole("article")
    .map((card) => within(card).getByRole("heading", { level: 3 }).textContent);
const navigate = async (href: string) => act(() => mocks.push(href));

it("offers available Types, Labels, Colours and Shared as native links with accessible names", async () => {
  render(app());
  await act(async () => {});
  expect(screen.getByRole("link", { name: "Search" }).getAttribute("aria-current")).toBe("page");
  for (const name of ["Types", "Labels", "Colours", "Shared"])
    expect(screen.getByRole("region", { name })).toBeDefined();
  const types = within(screen.getByRole("region", { name: "Types" }));
  expect(types.getAllByRole("link").map((el) => el.textContent)).toEqual([
    "Images",
    "Lists",
    "Reminders",
    "Links",
  ]);
  expect(
    screen.getByRole("link", { name: "Blue" }).querySelector('[data-note-colour="blue"]'),
  ).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Purple" })).toBeNull();
  expect(
    within(screen.getByRole("region", { name: "Labels" }))
      .getByRole("link", { name: label })
      .getAttribute("href"),
  ).toBe(noteSearchHref({ q: "", label }));
  expect(screen.getByRole("link", { name: bob }).getAttribute("href")).toBe(
    noteSearchHref({ q: "", shared: bob }),
  );
  expect(screen.queryByRole("link", { name: `${root}trash#me` })).toBeNull();
  expect(titles()).toEqual([]);
});

it("hides types without matches, counting archives and excluding Trash", () => {
  mocks.context.notes = [archived, { ...image, location: "trashed" }];
  render(app());
  const types = within(screen.getByRole("region", { name: "Types" }));
  expect(types.queryByRole("link", { name: "Images" })).toBeNull();
  expect(types.getAllByRole("link").map((el) => el.textContent)).toEqual([
    "Lists",
    "Reminders",
    "Links",
  ]);
});

it("activates a type tile from the keyboard, removes its chip, and restores a bookmarked URL", async () => {
  const user = userEvent.setup({ document });
  const ui = render(app());
  const tile = screen.getByRole("link", { name: "Lists" });
  tile.focus();
  await user.keyboard("{Enter}");
  expect(mocks.href).toBe("/notes/search?type=lists");
  expect(titles()).toEqual(["Garden", "Red garden", "Archived garden"]);
  const bookmark = mocks.href;
  fireEvent.click(screen.getByRole("link", { name: "Remove Type: Lists" }));
  expect(mocks.href).toBe("/notes/search");
  expect(screen.queryByRole("navigation", { name: "Active search filters" })).toBeNull();
  await navigate(bookmark);
  expect(screen.getByRole("link", { name: "Remove Type: Lists" })).toBeDefined();
  ui.unmount();
  render(app());
  expect(titles()).toEqual(["Garden", "Red garden", "Archived garden"]);
});

it("combines query, type, colour, label and collaborator; chips remove only their own field", async () => {
  mocks.href = noteSearchHref({ q: "sunflow", type: "lists", colour: "blue", label, shared: bob });
  render(app());
  expect(titles()).toEqual(["Garden", "Archived garden"]);
  const count = screen.getByText("2 notes found");
  expect(count.getAttribute("aria-live")).toBe("polite");
  expect(count.getAttribute("aria-atomic")).toBe("true");
  const chips = within(screen.getByRole("navigation", { name: "Active search filters" }));
  expect(chips.getAllByRole("link")).toHaveLength(6);
  fireEvent.click(chips.getByRole("link", { name: "Remove Colour: Blue" }));
  expect(parseNoteSearch(mocks.href.split("?")[1] as string)).toEqual({
    q: "sunflow",
    type: "lists",
    label,
    shared: bob,
  });
  expect(titles()).toEqual(["Garden", "Red garden", "Archived garden"]);
  fireEvent.click(screen.getByRole("link", { name: "Remove Search: sunflow" }));
  expect(parseNoteSearch(mocks.href.split("?")[1] as string).q).toBe("");
  fireEvent.click(screen.getByRole("link", { name: `Remove Label: ${label}` }));
  expect(parseNoteSearch(mocks.href.split("?")[1] as string).label).toBeUndefined();
  fireEvent.click(screen.getByRole("link", { name: `Remove Shared with: ${bob}` }));
  expect(parseNoteSearch(mocks.href.split("?")[1] as string).shared).toBeUndefined();
  fireEvent.click(screen.getByRole("link", { name: "Clear all" }));
  expect(mocks.href).toBe("/notes/search");
  expect(screen.getByRole("searchbox", { name: "Search notes" }).getAttribute("value")).toBe("");
  expect(screen.getByRole("region", { name: "Types" })).toBeDefined();
});

it("adds successive filters from text results and preserves them on text submission", () => {
  mocks.href = "/notes/search?q=sunflow";
  render(app());
  const more = screen.getByRole("button", { name: "Add filters" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(screen.getByRole("button", { name: "Hide filters" }).getAttribute("aria-expanded")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("link", { name: "Lists" }));
  fireEvent.click(screen.getByRole("link", { name: "Blue" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "Labels" })).getByRole("link", { name: label }),
  );
  fireEvent.click(screen.getByRole("link", { name: "Any shared note" }));
  expect(parseNoteSearch(mocks.href.split("?")[1] as string)).toEqual({
    q: "sunflow",
    type: "lists",
    colour: "blue",
    label,
    shared: "any",
  });
  expect(titles()).toEqual(["Garden", "Archived garden"]);
  const input = screen.getByRole("searchbox", { name: "Search notes" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "garden" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(parseNoteSearch(mocks.href.split("?")[1] as string)).toEqual({
    q: "garden",
    type: "lists",
    colour: "blue",
    label,
    shared: "any",
  });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  expect(parseNoteSearch(mocks.href.split("?")[1] as string).q).toBe("");
  expect(titles()).toEqual(["Garden", "Archived garden"]);
  fireEvent.click(screen.getByRole("button", { name: "Hide filters" }));
  expect(screen.queryByRole("region", { name: "Types" })).toBeNull();
});

it("uses the suite empty state for no results and returns to entry tiles on clear-all", () => {
  mocks.href = "/notes/search?q=missing&type=lists";
  render(app());
  expect(
    screen
      .getByRole("heading", { name: "No matching notes" })
      .closest('[data-variant="filtered-empty"]'),
  ).not.toBeNull();
  expect(screen.getByText("0 notes found").getAttribute("aria-live")).toBe("polite");
  fireEvent.click(screen.getByRole("link", { name: "Clear all" }));
  expect(screen.queryByRole("heading", { name: "No matching notes" })).toBeNull();
  expect(screen.getByRole("region", { name: "Types" })).toBeDefined();
});

it("ignores invalid URL fields and explains empty label/shared groups", () => {
  mocks.href = "/notes/search?type=invalid&colour=invalid&shared=javascript%3Avoid(0)&unknown=x";
  mocks.context.notes = [];
  mocks.context.labels = [];
  render(app());
  expect(screen.queryByRole("navigation", { name: "Active search filters" })).toBeNull();
  expect(screen.getByText("No labels yet")).toBeDefined();
  expect(screen.getByText("No shared notes found")).toBeDefined();
});

it("announces a singular result for a colour-only search", () => {
  mocks.href = "/notes/search?colour=red";
  render(app());
  expect(titles()).toEqual(["Red garden"]);
  expect(screen.getByText("1 note found").getAttribute("aria-live")).toBe("polite");
});
