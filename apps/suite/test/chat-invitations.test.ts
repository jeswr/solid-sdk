// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatClient, type Invitation, type Room } from "../src/apps/chat/lib/client";
import { ChatProvider, type ChatSession } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const { Invitations } = await import("../src/apps/chat/components/invitations");

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const ROOM = `${ROOT}chat/rooms/book-club/`;
const key = (webId: string) => `chat.invitation-dismissals.v1:${encodeURIComponent(webId)}`;
const room: Room = {
  url: ROOM,
  name: "Book club",
  members: [ME],
  creator: ME,
  created: undefined,
  isDirect: false,
};
const pod = createDemoPod({ root: ROOT });
function content(webId = ME, copies = false) {
  const session: ChatSession = {
    mode: "demo",
    webId,
    storageUrl: ROOT,
    displayName: "Alice",
    fetch: pod.fetch,
    reset: async () => {},
    subscribe: pod.subscribe,
  };
  return h(ChatProvider, {
    key: webId,
    session,
    children: copies ? h("div", null, h(Invitations), h(Invitations)) : h(Invitations),
  });
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
    { room: ROOM, actor: "https://sender.example/profile#me" },
  ]);
  await view.unmount();
  const populated = await mount(content());
  expect(populated.host.querySelector("h2")?.textContent).toBe("Invitations");
  expect(populated.host.querySelector("a")?.textContent).toBe("Book club");
  expect(populated.host.querySelector("a")?.getAttribute("href")).toBe(
    `/chat/r/${encodeRef(ROOM)}`,
  );
  expect(populated.host.textContent).toContain("From sender.example");
  expect(
    (
      await axe.run(populated.host, {
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
it("falls back on 403 without fetching the claimed sender's profile", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([
    { room: ROOM, actor: "https://hostile.example/profile#me" },
  ]);
  vi.mocked(ChatClient.prototype.room).mockRejectedValue(
    Object.assign(new Error("Forbidden"), { status: 403 }),
  );
  const profile = vi.spyOn(ChatClient.prototype, "profile");
  const view = await mount(content());
  expect(view.host.querySelector("a")?.textContent).toBe("Room invitation");
  expect(view.host.textContent).toContain("From hostile.example");
  expect(profile).not.toHaveBeenCalled();
});
it("persists bounded local dismissals per WebID without deleting inbox items", async () => {
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([{ room: ROOM }]);
  localStorage.setItem(
    key(ME),
    JSON.stringify(Array.from({ length: 205 }, (_, i) => `https://pod.example/r${i}/`)),
  );
  const transport = vi.spyOn(pod, "fetch");
  const view = await mount(content());
  expect(view.host.textContent).toContain("Unknown sender");
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("section")).toBeNull();
  expect(JSON.parse(localStorage.getItem(key(ME)) ?? "[]")).toHaveLength(200);
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
  vi.mocked(ChatClient.prototype.invitations).mockResolvedValue([{ room: ROOM }]);
  const view = await mount(content(ME, true));
  const other = await mount(content("https://bob.example/#me"));
  expect(view.host.querySelectorAll("section")).toHaveLength(2);
  await click(view.host.querySelector("button") as HTMLElement);
  expect(view.host.querySelector("section")).toBeNull();
  expect(other.host.querySelector("section")).not.toBeNull();
});
