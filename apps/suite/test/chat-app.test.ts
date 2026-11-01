// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { ChatClient } from "../src/apps/chat/lib/client";
import type { ChatSession } from "../src/apps/chat/state/chat-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as ChatSession | undefined,
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: mocks.session }),
}));

import { ChatApp, ChatLanding } from "../src/apps/chat/components/chat-app";
import { RoomView } from "../src/apps/chat/components/room";

const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const axe = requireUi("axe-core") as {
  run: (node: Element, options: object) => Promise<{ violations: unknown[] }>;
};
async function accessible(node: Element) {
  expect(
    (
      await axe.run(node, {
        rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
}
function setup(live = true) {
  const pod = createDemoPod({ root: ROOT });
  mocks.session = {
    mode: "demo",
    fetch: pod.fetch,
    storageUrl: ROOT,
    webId: ME,
    displayName: "Alice",
    reset: async () => {},
    ...(live ? { subscribe: pod.subscribe } : {}),
  };
  return new ChatClient(pod.fetch, ROOT, ME);
}
it("wires the actual session, frame, empty sidebar and empty main with valid heading order", async () => {
  setup();
  const view = await mount(h(ChatApp, { children: h(ChatLanding) }));
  const main = view.host.querySelector("main") as HTMLElement;
  const sidebar = view.host.querySelector('[aria-label="Conversations"]') as HTMLElement;
  expect(main.textContent).toContain("No conversations yet");
  expect(sidebar.textContent).toContain("Start a room");
  await accessible(main);
  await accessible(sidebar);
});
it("renders the polling capability fallback once and keeps unread/read hooks in the actual frame", async () => {
  const client = setup(false);
  const room = await client.createRoom({ name: "Polling room", members: [] });
  await client.send(room.url, "Hello");
  const view = await mount(h(ChatApp, { children: h(RoomView, { url: room.url }) }));
  expect(view.host.querySelectorAll(".chat-room-header .chat-hint")).toHaveLength(1);
  expect(view.host.querySelector(".chat-room-header .chat-hint")?.textContent).toBe(
    "Updates every 30 s",
  );
  expect(view.host.querySelector("main h1")?.textContent).toBe("Polling room");
  await accessible(view.host.querySelector("main") as HTMLElement);
});
