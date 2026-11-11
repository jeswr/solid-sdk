// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { EVENT_STATUS, type Invitation, RSVP_RESPONSE, readReplies } from "@jeswr/solid-events";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { InvitationDetail, OrganiserDetail } from "../../src/apps/events/components/event-detail";
import { EventForm } from "../../src/apps/events/components/event-form";
import { act, click, h, mount } from "../drive-ui-dom";

vi.mock("@jeswr/solid-events", async (original) => ({
  ...(await original<typeof import("@jeswr/solid-events")>()),
  readReplies: vi.fn().mockResolvedValue({
    replies: [],
    invalid: 0,
    total: 0,
    nextOffset: null,
    listingLimited: false,
  }),
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
    total: 1,
    nextOffset: null,
    listingLimited: false,
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
  expect(view.host.textContent).toContain("Replies (not verified): 1 going, 0 maybe, 0 can't go");
});
it("shows a separate unverified tally, estimated capacity and collapsed earlier guest replies", async () => {
  const old = {
    url: "https://host.example/old",
    event: `${event.url}#it`,
    displayName: "Tavi",
    guestKey: "sha256:guest",
    response: RSVP_RESPONSE.yes,
    additionalGuests: 2,
    repliedAt: new Date("2026-11-10T12:00Z"),
    receivedAt: new Date("2026-11-10T12:00Z"),
  };
  const latest = {
    ...old,
    url: "https://host.example/latest",
    response: RSVP_RESPONSE.no,
    repliedAt: new Date("2099-01-01"),
    receivedAt: new Date("2026-11-10T12:01Z"),
  };
  vi.mocked(readReplies).mockResolvedValueOnce({
    replies: [old, latest],
    invalid: 1,
    total: 3,
    nextOffset: null,
    listingLimited: false,
  });
  const view = await mount(
    h(InvitationDetail, { event: { ...event, capacity: 8 }, fetch: vi.fn() }),
  );
  expect(view.host.textContent).toContain("1 reply could not be loaded or was invalid");
  expect(view.host.textContent).toContain("Replies (not verified): 0 going, 0 maybe, 1 can't go");
  expect(view.host.textContent).toContain("8 places remaining (verified + unverified going)");
  expect(view.host.querySelector("details")?.open).toBe(false);
  expect(view.host.querySelector("summary")?.textContent).toBe("Earlier replies (1)");
});
it("keeps loaded replies visible, announces truncation and retries loading the next bounded page", async () => {
  const reply = {
    url: "https://host.example/one",
    event: `${event.url}#it`,
    displayName: "Cleo",
    guestKey: "sha256:cleo",
    response: RSVP_RESPONSE.yes,
    additionalGuests: 0,
    repliedAt: new Date(),
  };
  vi.mocked(readReplies).mockResolvedValueOnce({
    replies: [reply],
    invalid: 0,
    total: 201,
    nextOffset: 200,
    listingLimited: false,
  });
  const fetch = vi.fn();
  const view = await mount(h(InvitationDetail, { event, fetch }));
  expect(view.host.textContent).toContain("Showing 200 of 201 reply files");
  const load = () =>
    [...view.host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("more replies"),
    ) as HTMLButtonElement;
  let fail!: (error: Error) => void;
  vi.mocked(readReplies).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  await click(load());
  expect(load().disabled).toBe(true);
  expect(view.host.textContent).toContain("Cleo");
  await act(async () => {
    fail(new Error("offline"));
  });
  expect(view.host.textContent).toContain("Couldn't load more replies");
  vi.mocked(readReplies).mockResolvedValueOnce({
    replies: [
      { ...reply, url: "https://host.example/two", guestKey: "sha256:other", displayName: "Tavi" },
    ],
    invalid: 0,
    total: 201,
    nextOffset: null,
    listingLimited: false,
  });
  await click(load());
  expect(readReplies).toHaveBeenLastCalledWith(fetch, event.url, { offset: 200 });
  expect(view.host.textContent).toContain("Showing 201 of 201 reply files");
  expect(view.host.textContent).toContain("Cleo");
  expect(view.host.textContent).toContain("Tavi");
  expect(load()).toBeUndefined();
});
it("renders an oversized listing as a notice instead of an error state", async () => {
  vi.mocked(readReplies).mockResolvedValueOnce({
    replies: [],
    invalid: 0,
    total: null,
    nextOffset: null,
    listingLimited: true,
  });
  const view = await mount(h(InvitationDetail, { event, fetch: vi.fn() }));
  expect(view.host.textContent).toContain("reply listing exceeds the safety limits");
  expect(view.host.textContent).toContain("Some replies cannot be shown");
  expect(view.host.textContent).not.toContain("The first yes is on its way");
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
