// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import InboxPage from "./page";

const { state } = vi.hoisted(() => ({
  state: {
    data: [{ url: "https://pod.example/inbox/n", type: "Offer", read: false }],
    loading: false,
    error: undefined as Error | undefined,
    inboxUrl: "https://pod.example/inbox/",
    truncated: true,
    reload: vi.fn(),
    markRead: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/components/use-inbox", () => ({ useInbox: () => state }));
vi.mock("@/components/session-provider", () => ({
  useSession: () => ({ webId: "https://pod.example/profile#me" }),
}));
vi.mock("@/components/use-resource-notifications", () => ({ useResourceNotifications: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("shows the truncation note and an error state for a refused listing", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() => root.render(<InboxPage />));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Showing the newest 1",
    );
    state.error = new Error("Inbox HTTP 401");
    await act(() => root.render(<InboxPage />));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain("Inbox HTTP 401");
  } finally {
    await act(() => root.unmount());
    state.error = undefined;
  }
});
