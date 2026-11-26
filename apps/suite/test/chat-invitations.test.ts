// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ChatClient,
  type Invitation,
  type InvitationScan,
  type Room,
} from "../src/apps/chat/lib/client";
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
/** Rows with a name are verified own-pod rooms unless a test says otherwise. */
const scan = (
  invitations: (Omit<Invitation, "verified"> & { verified?: boolean })[],
  truncated = false,
  ownUnchecked = false,
): InvitationScan => ({
  invitations: invitations.map((invitation) => ({
    verified: invitation.name !== undefined,
    ...invitation,
  })),
  truncated,
  ownUnchecked,
});
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(ChatClient.prototype, "invitations").mockResolvedValue(scan([]));
  vi.spyOn(ChatClient.prototype, "room").mockResolvedValue(room);
});
afterEach(() => vi.restoreAllMocks());

it("renders a section only with invitations, links the name to Join, and passes axe", async () => {
  const view = await mount(content());
  expect(view.host.querySelector("section")).toBeNull();
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: "https://sender.example/profile#me", name: "Book club" }]),
  );
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
it("tells the user when invitations were left out, in static text only", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: "https://hostile.example/<b>x</b>#me", name: "Book club" }], true),
  );
  const view = await mount(content());
  expect(view.host.textContent).toContain("The inbox scan was cut off");
  expect(view.host.textContent).not.toContain("<b>");
  await view.unmount();
  // Nothing visible but truncated: the notice still shows.
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan([], true));
  const empty = await mount(content());
  expect(empty.host.textContent).toContain("The inbox scan was cut off");
  await empty.unmount();
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan([], false));
  const none = await mount(content());
  expect(none.host.textContent).not.toContain("not shown");
});
it("shows an unreachable own room under its fallback name without fetching the claimed sender's profile", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: "https://hostile.example/profile#me" }]),
  );
  const profile = vi.spyOn(ChatClient.prototype, "profile");
  const view = await mount(content());
  expect(view.host.querySelector("a")?.textContent).toBe("Room invitation (book-club)");
  expect(view.host.textContent).toContain("Invitation claims to be from hostile.example");
  expect(profile).not.toHaveBeenCalled();
  expect(ChatClient.prototype.room).not.toHaveBeenCalled();
});
it("persists bounded local dismissals per WebID without deleting inbox items", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: SENDER }]),
  );
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
  expect(JSON.parse(localStorage.getItem(key(ME)) ?? "null").ids).toHaveLength(206);
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
  const pending = deferred<InvitationScan>();
  vi.mocked(ChatClient.prototype.invitations).mockReturnValue(pending.promise);
  const view = await mount(content());
  const signal = vi.mocked(ChatClient.prototype.invitations).mock.calls[0]?.[0]?.signal;
  await view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(() => pending.resolve(scan([{ room: ROOM, actor: "urn:forged:sender" }])));
});

it("synchronizes dismissal across sidebar copies while keeping another WebID visible", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: SENDER }]),
  );
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
    .mockImplementation(async () => scan([{ room: ROOM, actor: SENDER, name: "Book club" }]));
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
    .mockResolvedValueOnce(scan([{ room: ROOM, actor: SENDER }]))
    .mockResolvedValue(scan([]));
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
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan(invitations));
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
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan([...own, foreign]));
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
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([
      { room: "https://foreign.example/chat/rooms/r/" },
      { room: ROOM, actor: SENDER, name: "Book club" },
      { room: `${ROOT}chat/rooms/two/`, actor: SENDER, name: "Two" },
    ]),
  );
  const view = await mount(content());
  expect(view.host.querySelector("details")).toBeNull();
  expect(view.host.textContent).toContain("Unknown sender");
  expect(view.host.textContent).not.toContain("Dismiss all");
});

it("removes the empty Invitations heading once focus leaves it, and at once in other copies", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: SENDER, name: "Book club" }]),
  );
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
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([
      { room: ROOM, actor: SENDER, name: "Book club" },
      { room: other, actor: SENDER, name: "Other room" },
    ]),
  );
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
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: SENDER, name: "Book club" }]),
  );
  const view = await mount(content(ME, false, true));
  const tick = interval.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
  if (typeof tick !== "function") throw new Error("Chat poll was not installed");
  await act(() => tick());
  expect(ChatClient.prototype.invitations).toHaveBeenCalledTimes(1);
  expect(view.host.querySelector("a")?.textContent).toBe("Book club");
});

it("keeps dismissal live when storage writes are blocked", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: SENDER }]),
  );
  const storagePrototype = Object.getPrototypeOf(localStorage);
  vi.spyOn(storagePrototype, "setItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  const view = await mount(content(ME, true));
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("li")).toBeNull();
});

const forged = (count: number, prefix = "forged") =>
  Array.from({ length: count }, (_, i) => ({
    room: `https://foreign.example/chat/rooms/${prefix}${i}/`,
    actor: SENDER,
  }));
const genuine = { room: "https://foreign.example/chat/rooms/genuine/", actor: SENDER };

it("folds unverified rows beyond 20 behind a real Show all button and reveals them in a bounded list", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([{ room: ROOM, actor: SENDER, name: "Book club" }, ...forged(25), genuine]),
  );
  const view = await mount(content());
  const rowRooms = () =>
    Array.from(view.host.querySelectorAll("li")).map((row) => row.dataset.room);
  // Verified row plus the first 20 unverified rows; the genuine one sorts last and is folded.
  expect(rowRooms()).toHaveLength(21);
  expect(rowRooms()).toContain(ROOM);
  expect(rowRooms()).not.toContain(genuine.room);
  expect(view.host.textContent).toContain("6 more unverified invitations are hidden.");
  const show = button(view.host, "Show all");
  expect(show.tagName).toBe("BUTTON");
  expect(show.textContent).toBe("Show all");
  await click(show);
  expect(rowRooms()).toContain(genuine.room);
  expect(rowRooms()).toHaveLength(27);
  expect(view.host.textContent).not.toContain("more unverified invitations are hidden");
  const more = view.host.querySelector(".chat-invitations-more") as HTMLElement;
  expect(more.style.overflowY).toBe("auto");
  expect(more.querySelectorAll("li")).toHaveLength(6);
  expect(
    (
      await axe.run(view.host, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it("applies dismissals before the cap, so dismissing forged rows reveals the genuine one without Show all", async () => {
  const spam = forged(25, "a");
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(
    scan([...spam, { ...genuine, room: "https://foreign.example/chat/rooms/z-genuine/" }]),
  );
  localStorage.setItem(
    key(ME),
    JSON.stringify({ version: 1, accountId: ME, ids: spam.map((row) => row.room) }),
  );
  const view = await mount(content());
  expect(Array.from(view.host.querySelectorAll("li")).map((row) => row.dataset.room)).toEqual([
    "https://foreign.example/chat/rooms/z-genuine/",
  ]);
  expect(view.host.textContent).not.toContain("Show all");
  expect(view.host.textContent).not.toContain("hidden");
});

it("never folds verified rows, and shows the scan notices with the Invitations heading", async () => {
  const verified = Array.from({ length: 25 }, (_, i) => ({
    room: `${ROOT}chat/rooms/v${i}/`,
    actor: SENDER,
    name: `V${i}`,
  }));
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan(verified));
  const view = await mount(content());
  expect(view.host.querySelectorAll("li")).toHaveLength(25);
  expect(view.host.textContent).not.toContain("Show all");
  await view.unmount();
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan([], false, true));
  const own = await mount(content());
  expect(own.host.querySelector("h2")?.textContent).toBe("Invitations");
  expect(own.host.textContent).toContain("Invitations to rooms in your pod could not be checked.");
  await own.unmount();
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan([], true));
  const cut = await mount(content());
  expect(cut.host.querySelector("h2")?.textContent).toBe("Invitations");
  expect(cut.host.textContent).toContain("The inbox scan was cut off");
});

it("Dismiss all over more than 200 rows evicts no room the scan still returns, and trims only stale ones", async () => {
  const verifiedRow = { room: ROOM, actor: SENDER, name: "Book club" };
  const rows = forged(250);
  const early = rows.slice(0, 10).map((row) => row.room);
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan([verifiedRow, ...rows]));
  // 10 earlier dismissals of rooms still in the scan, behind 595 stale ones (oldest first).
  const stale = Array.from({ length: 595 }, (_, i) => `https://stale.example/chat/rooms/s${i}/`);
  localStorage.setItem(
    key(ME),
    JSON.stringify({ version: 1, accountId: ME, ids: [...stale, ...early] }),
  );
  const view = await mount(content());
  await click(button(view.host, "Show all"));
  await click(button(view.host, "Dismiss all 241 invitations"));
  expect(view.host.querySelector("li")).toBeNull();
  const ids: string[] = JSON.parse(localStorage.getItem(key(ME)) as string).ids;
  expect(ids.length).toBeLessThanOrEqual(600);
  for (const room of [ROOM, ...rows.map((row) => row.room)]) expect(ids).toContain(room);
  // The oldest stale rooms were the ones trimmed.
  expect(ids).not.toContain(stale[0]);
  expect(ids).toContain(stale.at(-1));
  await view.unmount();
  // The next scan returns the same rows: none reappears.
  const next = await mount(content());
  expect(next.host.querySelector("li")).toBeNull();
  expect(next.host.querySelector("section")).toBeNull();
});

it("moves focus to the first revealed row after Show all, with the button outside the status", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue(scan(forged(25)));
  const view = await mount(content());
  const show = button(view.host, "Show all");
  expect(show.closest('[role="status"]')).toBeNull();
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain("5 more unverified");
  show.focus();
  await click(show);
  const first = view.host.querySelector(".chat-invitations-more li button") as HTMLElement;
  expect(document.activeElement).toBe(first);
  expect(document.activeElement).not.toBe(document.body);
});
