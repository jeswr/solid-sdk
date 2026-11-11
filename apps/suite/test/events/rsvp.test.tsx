// AUTHORED-BY Codex (GPT-6.1 Sol)

import { EVENT_STATUS, type Invitation, RSVP_RESPONSE } from "@jeswr/solid-events";
import { expect, it, vi } from "vitest";
import { RsvpPanel } from "../../src/apps/events/components/rsvp-panel";
import { act, deferred, h, mount } from "../drive-ui-dom";

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: notices,
}));
const event: Invitation = {
  url: "https://host.example/events/e/index.ttl",
  etag: '"one"',
  name: "Supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: "https://host.example/me",
  eventStatus: EVENT_STATUS.scheduled,
  visibility: "link",
  guestListVisible: false,
  publication: "published",
  created: new Date(),
  modified: new Date(),
};
function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
it("shows closed and sign-in states without fetching replies", async () => {
  const fetch = vi.fn();
  const view = await mount(
    h(RsvpPanel, { event: { ...event, publication: "draft" }, fetch, onReply: vi.fn() }),
  );
  expect(view.host.textContent).toContain("Replies are closed");
  await view.render(
    h(RsvpPanel, { event: { ...event, visibility: "invitees" }, fetch, onReply: vi.fn() }),
  );
  expect(view.host.textContent).toContain("Sign in with your invited WebID");
  expect(fetch).not.toHaveBeenCalled();
});
it("hydrates its scoped guest receipt, submits optimistically and rolls back on failure", async () => {
  localStorage.clear();
  localStorage.setItem(
    `events:reply:anonymous:${event.url}`,
    JSON.stringify({
      guestKey: "receipt",
      response: RSVP_RESPONSE.maybe,
      displayName: "Tavi Moss",
    }),
  );
  const pending = deferred<Response>();
  const fetch = vi.fn().mockReturnValue(pending.promise);
  const onReply = vi.fn();
  const view = await mount(h(RsvpPanel, { event, fetch, onReply }));
  expect(view.host.textContent).toContain("Your reply is in");
  const form = view.host.querySelector("form");
  if (!form) throw new Error("Missing RSVP form");
  // Native FormData differs between jsdom and Node; use the browser's form implementation.
  const BrowserFormData = window.FormData;
  vi.stubGlobal("FormData", BrowserFormData);
  await act(() => submit(form));
  expect(view.host.textContent).toContain("Sending your reply");
  await act(async () => {
    pending.resolve(new Response(null, { status: 403 }));
  });
  await vi.waitFor(() => expect(notices.error).toHaveBeenCalled());
  expect(onReply).not.toHaveBeenCalled();
});
