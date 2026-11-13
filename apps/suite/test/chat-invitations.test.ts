// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, type Invitation, type Room } from "../src/apps/chat/lib/client";
import {
  ChatProvider,
  type ChatSession,
  useChat,
  useChatActions,
} from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const { Invitations } = await import("../src/apps/chat/components/invitations");

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const ROOM = `${ROOT}chat/rooms/book-club/`;

import { invitationDismissalKey as key } from "../src/apps/chat/state/local-state";

const SENDER = "https://sender.example/profile#me";
const room: Room = {
  url: ROOM,
  name: "Book club",
  members: [ME, SENDER],
  creator: ME,
  created: undefined,
  isDirect: false,
};
const pod = createDemoPod({ root: ROOT });
function content(webId = ME, copies = false, polling = false) {
  const session: ChatSession = {
    mode: "demo",
    webId,
    storageUrl: ROOT,
    displayName: "Alice",
    fetch: pod.fetch,
    reset: async () => {},
    ...(polling ? {} : { subscribe: pod.subscribe }),
  };
  return h(ChatProvider, {
    key: webId,
    session,
    children: copies
      ? h("main", null, h(Invitations), h(Invitations))
      : h("main", null, h(Invitations), h(Controls)),
  });
}
function Controls() {
  const { invalidate } = useChat();
  const actions = useChatActions();
  return h(
    "div",
    null,
    h("button", { onClick: invalidate }, "Revision"),
    h("button", { onClick: () => actions.join(ROOM) }, "Join test room"),
  );
}
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const axe = requireUi("axe-core") as {
  run(node: Element, options: object): Promise<{ violations: unknown[] }>;
};
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(ChatClient.prototype, "invitations").mockResolvedValue([]);
  vi.spyOn(ChatClient.prototype, "room").mockResolvedValue(room);
});
afterEach(() => vi.restoreAllMocks());

it("renders a section only with invitations, links the name to Join, and passes axe", async () => {
  const view = await mount(content());
  expect(view.host.querySelector("section")).toBeNull();
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: ROOM, actor: "https://sender.example/profile#me", name: "Book club" },
  ]);
  await view.unmount();
  const populated = await mount(content());
  expect(populated.host.querySelector("h2")?.textContent).toBe("Invitations");
  expect(populated.host.querySelector("a")?.textContent).toBe("Book club");
  expect(populated.host.querySelector("a")?.getAttribute("href")).toBe(
    `/chat/r/${encodeRef(ROOM)}`,
  );
  expect(populated.host.textContent).toContain("Invitation claims to be from sender.example");
  expect(
    (
      await axe.run(populated.host, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
it("shows an unreachable own room under its fallback name without fetching the claimed sender's profile", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: ROOM, actor: "https://hostile.example/profile#me" },
  ]);
  const profile = vi.spyOn(ChatClient.prototype, "profile");
  const view = await mount(content());
  expect(view.host.querySelector("a")?.textContent).toBe("Room invitation (book-club)");
  expect(view.host.textContent).toContain("Invitation claims to be from hostile.example");
  expect(profile).not.toHaveBeenCalled();
  expect(ChatClient.prototype.room).not.toHaveBeenCalled();
});
it("persists bounded local dismissals per WebID without deleting inbox items", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([{ room: ROOM, actor: SENDER }]);
  localStorage.setItem(
    key(ME),
    JSON.stringify({
      version: 1,
      accountId: ME,
      ids: Array.from({ length: 205 }, (_, i) => `https://pod.example/r${i}/`),
    }),
  );
  const transport = vi.spyOn(pod, "fetch");
  const view = await mount(content());
  expect(view.host.textContent).toContain("Invitation claims to be from sender.example");
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("li")).toBeNull();
  expect(document.activeElement).toBe(view.host.querySelector("h2"));
  expect(JSON.parse(localStorage.getItem(key(ME)) ?? "null").ids).toHaveLength(200);
  await view.unmount();
  const reopened = await mount(content());
  expect(reopened.host.querySelector("section")).toBeNull();
  await reopened.render(content("https://bob.example/#me"));
  expect(reopened.host.querySelector("section")).not.toBeNull();
  expect(transport.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});
it("contains read failures with inline retry and throttles focus refreshes", async () => {
  const invitations = vi
    .mocked(ChatClient.prototype.invitations)
    .mockRejectedValueOnce(new Error("Offline"));
  let now = 100_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const view = await mount(content());
  expect(view.host.textContent).toContain("Couldn't load invitations");
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("section")).toBeNull();
  expect(invitations).toHaveBeenCalledTimes(2);
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(invitations).toHaveBeenCalledTimes(2);
  now += 30_000;
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(invitations).toHaveBeenCalledTimes(3);
  await view.unmount();
  now += 30_000;
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(invitations).toHaveBeenCalledTimes(3);
});
it("aborts stale reads on unmount and tolerates malformed dismissal storage", async () => {
  localStorage.setItem(key(ME), "not JSON");
  const pending = deferred<Invitation[]>();
  vi.mocked(ChatClient.prototype.invitations).mockReturnValue(pending.promise);
  const view = await mount(content());
  const signal = vi.mocked(ChatClient.prototype.invitations).mock.calls[0]?.[0]?.signal;
  await view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(() => pending.resolve([{ room: ROOM, actor: "urn:forged:sender" }]));
});

it("synchronizes dismissal across sidebar copies while keeping another WebID visible", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([{ room: ROOM, actor: SENDER }]);
  const view = await mount(content(ME, true));
  const other = await mount(content("https://bob.example/#me"));
  expect(view.host.querySelectorAll("section")).toHaveLength(2);
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("li")).toBeNull();
  expect(other.host.querySelector("section")).not.toBeNull();
});

it("does not refresh for revisions, changes, online events or polling, and preserves room rows on focus", async () => {
  let now = 100_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const read = vi
    .mocked(ChatClient.prototype.invitations)
    .mockImplementation(async () => [{ room: ROOM, actor: SENDER, name: "Book club" }]);
  const view = await mount(content());
  const link = view.host.querySelector("a");
  await click(
    Array.from(view.host.querySelectorAll("button")).find(
      (button) => button.textContent === "Revision",
    ) as HTMLElement,
  );
  await act(() => window.dispatchEvent(new Event("online")));
  expect(read).toHaveBeenCalledTimes(1);
  now += 30_000;
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(read).toHaveBeenCalledTimes(2);
  expect(view.host.querySelector("a")).toBe(link);
  expect(link?.textContent).toBe("Book club");
  // Rows render the scan's checked rooms; they never read rooms themselves.
  expect(ChatClient.prototype.room).not.toHaveBeenCalled();
});

it("refreshes after an explicit Join and removes the joined invitation", async () => {
  vi.mocked(ChatClient.prototype.invitations)
    .mockResolvedValueOnce([{ room: ROOM, actor: SENDER }])
    .mockResolvedValue([]);
  const view = await mount(content());
  await click(
    Array.from(view.host.querySelectorAll("button")).find(
      (button) => button.textContent === "Join test room",
    ) as HTMLElement,
  );
  expect(ChatClient.prototype.invitations).toHaveBeenCalledTimes(2);
  expect(view.host.querySelector("section")).toBeNull();
});

const button = (host: Element, text: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  ) as HTMLElement;

it("renders foreign-pod invitations as plain text with short dismiss names, collapses over three, and dismisses all", async () => {
  const invitations = Array.from({ length: 4 }, (_, i) => ({
    room: `https://foreign.example/chat/rooms/r${i}/`,
    actor: SENDER,
  }));
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(invitations);
  const view = await mount(content());
  expect(view.host.querySelector("a")).toBeNull();
  expect(view.host.querySelector("details")?.open).toBe(false);
  expect(view.host.querySelector("summary")?.textContent).toBe("4 invitations from other pods");
  const names = Array.from(view.host.querySelectorAll("li button")).map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(names).toEqual(invitations.map((_, i) => `Dismiss invitation to foreign.example/r${i}`));
  expect(view.host.textContent).toContain(`Room invitation (${invitations[0]?.room})`);
  expect(view.host.textContent).toContain("Opens when Chat supports rooms in other pods");
  await click(button(view.host, "Dismiss all 4 invitations"));
  expect(view.host.querySelector("li")).toBeNull();
  expect(document.activeElement).toBe(view.host.querySelector("h2"));
  expect(JSON.parse(localStorage.getItem(key(ME)) as string).ids).toEqual(
    invitations.map((invitation) => invitation.room),
  );
});

it("collapses more than three own-pod invitations, and Dismiss all covers every shown row", async () => {
  const own = Array.from({ length: 4 }, (_, i) => ({
    room: `${ROOT}chat/rooms/r${i}/`,
    actor: SENDER,
    name: `Room ${i}`,
  }));
  const foreign = { room: "https://foreign.example/chat/rooms/f/", actor: SENDER };
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([...own, foreign]);
  const view = await mount(content());
  expect(
    Array.from(view.host.querySelectorAll("summary")).map((summary) => summary.textContent),
  ).toEqual(["4 room invitations in your pod"]);
  expect(view.host.querySelectorAll("details li")).toHaveLength(4);
  await click(button(view.host, "Dismiss all 5 invitations"));
  expect(view.host.querySelector("li")).toBeNull();
  expect(JSON.parse(localStorage.getItem(key(ME)) as string).ids).toEqual([
    ...own.map((invitation) => invitation.room),
    foreign.room,
  ]);
});

it("shows up to three invitations without collapsing or a bulk dismissal", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: "https://foreign.example/chat/rooms/r/" },
    { room: ROOM, actor: SENDER, name: "Book club" },
    { room: `${ROOT}chat/rooms/two/`, actor: SENDER, name: "Two" },
  ]);
  const view = await mount(content());
  expect(view.host.querySelector("details")).toBeNull();
  expect(view.host.textContent).toContain("Unknown sender");
  expect(view.host.textContent).not.toContain("Dismiss all");
});

it("removes the empty Invitations heading once focus leaves it, and at once in other copies", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: ROOM, actor: SENDER, name: "Book club" },
  ]);
  const view = await mount(content(ME, true));
  const [acting, other] = Array.from(view.host.querySelectorAll("section"));
  await click(acting?.querySelector("li button") as HTMLElement);
  const sections = view.host.querySelectorAll("section");
  expect(sections).toHaveLength(1);
  expect(sections[0]).toBe(acting);
  expect(other?.isConnected).toBe(false);
  const heading = view.host.querySelector("h2") as HTMLElement;
  expect(document.activeElement).toBe(heading);
  expect(acting?.querySelector("li")).toBeNull();
  await act(() => heading.blur());
  expect(view.host.querySelector("section")).toBeNull();
});

it("names dismiss buttons and moves focus to the next row, then the heading", async () => {
  const other = `${ROOT}chat/rooms/other/`;
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: ROOM, actor: SENDER, name: "Book club" },
    { room: other, actor: SENDER, name: "Other room" },
  ]);
  const view = await mount(content());
  const first = view.host.querySelector(
    'button[aria-label="Dismiss invitation to Book club"]',
  ) as HTMLElement;
  first.focus();
  await click(first);
  expect(document.activeElement?.textContent).toBe("Other room");
  await click(
    view.host.querySelector('button[aria-label="Dismiss invitation to Other room"]') as HTMLElement,
  );
  expect(document.activeElement).toBe(view.host.querySelector("h2"));
});

it("does not read invitations on the Chat polling tick", async () => {
  const interval = vi.spyOn(globalThis, "setInterval");
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: ROOM, actor: SENDER, name: "Book club" },
  ]);
  const view = await mount(content(ME, false, true));
  const tick = interval.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
  if (typeof tick !== "function") throw new Error("Chat poll was not installed");
  await act(() => tick());
  expect(ChatClient.prototype.invitations).toHaveBeenCalledTimes(1);
  expect(view.host.querySelector("a")?.textContent).toBe("Book club");
});

it("keeps dismissal live when storage writes are blocked", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([{ room: ROOM, actor: SENDER }]);
  const storagePrototype = Object.getPrototypeOf(localStorage);
  vi.spyOn(storagePrototype, "setItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  const view = await mount(content(ME, true));
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("li")).toBeNull();
});
