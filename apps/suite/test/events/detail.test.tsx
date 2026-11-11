// AUTHORED-BY Codex (GPT-6.1 Sol)
import { EVENT_STATUS, type Invitation, RSVP_RESPONSE, readReplies } from "@jeswr/solid-events";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { InvitationDetail, OrganiserDetail } from "../../src/apps/events/components/event-detail";
import { EventForm } from "../../src/apps/events/components/event-form";
import { act, click, h, mount } from "../drive-ui-dom";

vi.mock("@jeswr/solid-events", async (original) => ({
  ...(await original<typeof import("@jeswr/solid-events")>()),
  readReplies: vi.fn().mockResolvedValue(Object.assign([], { replies: [], invalid: 0 })),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? h("div", { role: "dialog" }, children) : null,
  DialogContent: ({ children }: { children: ReactNode }) => h("div", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => h("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => h("h2", null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => h("p", null, children),
}));
vi.mock("@/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: ReactNode }) => h("h2", null, children),
}));
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../src/apps/events/state/events-context", () => ({ useEvents: () => context.value }));
const event: Invitation = {
  url: "https://host.example/events/e/index.ttl",
  etag: '"one"',
  name: "Supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: "https://host.example/me",
  eventStatus: EVENT_STATUS.scheduled,
  visibility: "link",
  guestListVisible: true,
  publication: "published",
  created: new Date(),
  modified: new Date(),
  image: "https://images.example/cover.jpg",
};
it("renders validated cover images with private referrers and lazy loading", async () => {
  const view = await mount(h(InvitationDetail, { event, fetch: vi.fn(), organiser: true }));
  const image = view.host.querySelector("img");
  expect(image?.src).toBe(event.image);
  expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(image?.getAttribute("loading")).toBe("lazy");
  await view.render(h(InvitationDetail, { event, fetch: vi.fn() }));
  expect(view.host.querySelector("img")?.src).toBe(event.image);
  await view.render(
    h(InvitationDetail, { event: { ...event, image: "javascript:alert(1)" }, fetch: vi.fn() }),
  );
  expect(view.host.querySelector("img")).toBeNull();
});
it("shows unreadable reply counts and unverified claims separately", async () => {
  vi.mocked(readReplies).mockResolvedValueOnce({
    invalid: 2,
    replies: [
      {
        url: `${event.url}/reply`,
        event: `${event.url}#it`,
        agent: "https://guest.example/me",
        displayName: "Cleo",
        response: RSVP_RESPONSE.yes,
        additionalGuests: 0,
        repliedAt: new Date(),
      },
    ],
  });
  const view = await mount(h(InvitationDetail, { event, fetch: vi.fn(), organiser: true }));
  expect(view.host.textContent).toContain("2 replies could not be loaded");
  expect(view.host.textContent).toContain("Unverified replies");
  expect(view.host.textContent).toContain("Cleo");
});
it("wraps organiser reads in the guarded transport", async () => {
  const raw = vi.fn();
  context.value = {
    session: { mode: "solid", fetch: raw, webId: event.organizer },
    controller: { repository: { invitees: vi.fn().mockResolvedValue([]) } },
  };
  await mount(h(OrganiserDetail, { event, onBack: vi.fn() }));
  const wrapped = vi.mocked(readReplies).mock.calls.at(-1)?.[0];
  expect(wrapped).not.toBe(raw);
  await expect(wrapped?.("http://127.0.0.1/private")).rejects.toThrow();
  expect(raw).not.toHaveBeenCalled();
});
it("requires confirmation to publish a saved private draft", async () => {
  const save = vi.fn();
  await mount(
    h(EventForm, {
      open: true,
      onClose: vi.fn(),
      owner: event.organizer,
      existing: { ...event, publication: "draft" },
      onSave: save,
    }),
  );
  const choice = document.querySelector<HTMLInputElement>(
    'input[name="publication"][value="published"]',
  );
  expect(choice).not.toBeNull();
  if (!choice) throw new Error("Missing publication choice");
  await click(choice);
  vi.stubGlobal("FormData", window.FormData);
  await act(() => {
    const form = document.querySelector("form");
    if (!form) throw new Error("Missing invitation form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(save).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Confirm publication",
  );
  expect(confirm).toBeDefined();
  if (!confirm) throw new Error("Missing confirmation");
  await click(confirm);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ publication: "published" }), []);
});
