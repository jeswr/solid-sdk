// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { ChatClient, type ChatSearchResult, type Message } from "../src/apps/chat/lib/client";
import { SearchError } from "../src/apps/chat/lib/search";
import { ChatProvider, type ChatSession } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const routing = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("../src/apps/chat/components/chat-app", () => ({
  PersonName: ({ webId }: { webId: string }) => webId || "Unknown author",
  ChatFailure: ({ retry }: { retry: () => void }) =>
    h(
      "div",
      { role: "alert" },
      "Couldn't search messages",
      h("button", { onClick: retry }, "Retry"),
    ),
}));

import { ChatSearchPage } from "../src/apps/chat/components/search";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const ROOM = `${ROOT}chat/rooms/garden/`;
const session: ChatSession = {
  mode: "demo",
  webId: ME,
  storageUrl: ROOT,
  displayName: "Alice",
  fetch: createDemoPod({ root: ROOT }).fetch,
  reset: async () => {},
};
const message: Message = {
  id: `${ROOM}2026/11/03.ttl#one`,
  author: ME,
  published: "2026-11-03T10:00:00Z",
  content: "<img src=x> garden plans",
  mediaType: "text/plain",
  updated: undefined,
  tombstone: false,
  deleted: false,
  edited: false,
  reactions: [],
};
const response: ChatSearchResult = {
  results: [
    {
      room: { url: ROOM, name: "Garden club" },
      message,
      score: 1,
      snippet: { text: message.content, ranges: [[12, 18]] },
    },
  ],
  searchedRooms: 3,
  skipped: [],
  truncated: true,
};
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const axe = requireUi("axe-core") as {
  run: (node: Element, options: object) => Promise<{ violations: unknown[] }>;
};
async function accessible(host: Element) {
  expect(
    (
      await axe.run(host, {
        rules: {
          "color-contrast": { enabled: false },
          region: { enabled: false },
        },
      })
    ).violations,
  ).toEqual([]);
}
const tree = (query: string) =>
  h(ChatProvider, { session, children: h(ChatSearchPage, { query }) });
afterEach(() => {
  vi.restoreAllMocks();
  routing.push.mockClear();
});

it("renders safe highlighted text, local time, counts and a native message link", async () => {
  vi.spyOn(ChatClient.prototype, "search").mockResolvedValue(response);
  const view = await mount(tree("garden"));
  expect(view.host.querySelector("h1")?.textContent).toBe("Search");
  expect(view.host.querySelector("mark")?.textContent).toBe("garden");
  expect(view.host.querySelector("img")).toBeNull();
  expect(view.host.querySelector(".chat-search-snippet")?.textContent).toBe(message.content);
  expect(view.host.querySelector('[role="status"]')?.textContent).toBe(
    "1 message in 1 room. Searched the last 30 days",
  );
  expect(view.host.querySelector("time")?.getAttribute("datetime")).toBe(message.published);
  expect(view.host.querySelector("time")?.textContent).toBe(
    new Date(message.published as string).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  );
  expect(view.host.querySelector("li a")?.getAttribute("href")).toBe(
    `/chat/r/${encodeRef(ROOM)}?message=${encodeRef(message.id)}`,
  );
  expect(document.activeElement).toBe(view.host.querySelector("input"));
  expect(view.host.textContent).toContain("from:name in:room on:YYYY-MM-DD has:link");
  await accessible(view.host);
});
it("provides an editable query and URL-encodes searches submitted with the form", async () => {
  vi.spyOn(ChatClient.prototype, "search").mockResolvedValue(response);
  const view = await mount(tree("garden"));
  const field = view.host.querySelector("input") as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      field,
      'garden in:"Book club" & café',
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    view.host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(routing.push).toHaveBeenCalledWith(
    `/chat/search?q=${encodeURIComponent('garden in:"Book club" & café')}`,
  );
  await view.render(tree("new query"));
  expect(field.value).toBe("new query");
});
it("shows initial, loading, empty and skipped-room states with retry", async () => {
  const pending = deferred<ChatSearchResult>();
  const search = vi.spyOn(ChatClient.prototype, "search").mockReturnValueOnce(pending.promise);
  const view = await mount(tree(""));
  expect(search).not.toHaveBeenCalled();
  expect(view.host.textContent).toContain("Search messages across your joined rooms.");
  await accessible(view.host);
  await view.render(tree("missing"));
  expect(view.host.querySelector('[aria-label="Searching messages"]')).not.toBeNull();
  await accessible(view.host);
  await act(() =>
    pending.resolve({
      results: [],
      searchedRooms: 2,
      skipped: [{ url: ROOM, name: "Unavailable room" }],
      truncated: false,
    }),
  );
  expect(view.host.querySelector('[role="status"]')?.textContent).toBe("0 messages in 0 rooms");
  expect(view.host.textContent).toContain("No messages found.");
  expect(view.host.textContent).toContain("Couldn't search 1 room: Unavailable room");
  await accessible(view.host);
  search.mockResolvedValue(response);
  await click(view.host.querySelector(".chat-search-skipped button") as Element);
  expect(view.host.querySelectorAll(".chat-search-results li")).toHaveLength(1);
});
it("shows typed search errors as Check your search and other errors with recovery", async () => {
  const search = vi.spyOn(ChatClient.prototype, "search");
  for (const code of [
    "INVALID_QUERY",
    "INVALID_TIME_ZONE",
    "INVALID_DATE",
    "EMPTY_QUERY",
    "UNTERMINATED_PHRASE",
  ] as const) {
    search.mockRejectedValue(new SearchError(code));
    const view = await mount(tree("bad query"));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("Check your search");
    await accessible(view.host);
    await view.unmount();
  }
  search.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(response);
  const view = await mount(tree("garden"));
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't search messages",
  );
  await click(view.host.querySelector('[role="alert"] button') as Element);
  expect(view.host.querySelectorAll(".chat-search-results li")).toHaveLength(1);
});
it("ignores stale responses after the query changes or becomes empty", async () => {
  const first = deferred<ChatSearchResult>();
  const second = deferred<ChatSearchResult>();
  const search = vi
    .spyOn(ChatClient.prototype, "search")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const view = await mount(tree("first"));
  await view.render(tree("second"));
  await act(() => second.resolve({ ...response, results: [] }));
  await act(() => first.resolve(response));
  expect(view.host.querySelectorAll(".chat-search-results li")).toHaveLength(0);
  await view.render(tree(""));
  expect(view.host.textContent).toContain("Search messages across your joined rooms.");
  expect(search).toHaveBeenCalledTimes(2);
});
