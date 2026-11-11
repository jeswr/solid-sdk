// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { type UseInbox, useInbox } from "./use-inbox";

const { session, inboxFor } = vi.hoisted(() => ({
  session: {
    webId: "https://pod.example/profile#me",
    activeStorage: "https://pod.example/",
    status: "logged-in",
    podFetch: vi.fn(),
  },
  inboxFor: vi.fn(),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => session }));
vi.mock("@/lib/inbox", () => ({ inboxFor }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let state: UseInbox;
function Harness() {
  state = useInbox();
  return null;
}
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  session.status = "logged-in";
  inboxFor.mockReset();
});

test("carries truncation to the UI, propagates listing failures and clears it on sign-out", async () => {
  const listPage = vi.fn().mockResolvedValue({
    notifications: [{ url: "https://pod.example/inbox/n", type: "Offer", read: false }],
    truncated: true,
  });
  inboxFor.mockResolvedValue({ inboxUrl: "https://pod.example/inbox/", listPage });
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(<Harness />);
  });
  expect(state.truncated).toBe(true);
  expect(state.data).toHaveLength(1);
  listPage.mockRejectedValue(new Error("Inbox HTTP 403"));
  await act(async () => state.reload());
  expect(state.error?.message).toBe("Inbox HTTP 403");
  expect(state.truncated).toBe(false);
  session.status = "logged-out";
  await act(async () => {
    root?.render(<Harness />);
  });
  expect(state.truncated).toBe(false);
});
