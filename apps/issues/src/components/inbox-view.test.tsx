// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The LDN inbox view: renders parsed notifications, and (via the inbox.ts SSRF
// guard) shows an empty state for a foreign / absent inbox. The view is wired to
// `readInbox`, which is mocked here so the component test needs no live server.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { InboxNotification } from "@/lib/inbox";

const readInbox = vi.fn();
vi.mock("@/lib/inbox", () => ({ readInbox: (...args: unknown[]) => readInbox(...args) }));

// usePerson / people.ts is not used by the inbox card (actors are shown as host
// only, never dereferenced), so no profile-fetch stub is needed.

import { InboxView } from "@/components/inbox-view";

const WEBID = "https://pod.example/alice/profile/card#me";
const OWN = ["https://pod.example/alice/"];
const AS = "https://www.w3.org/ns/activitystreams#";

afterEach(() => {
  cleanup();
  readInbox.mockReset();
});

describe("InboxView", () => {
  it("renders the parsed notifications from the mocked inbox", async () => {
    const notifications: InboxNotification[] = [
      {
        url: "https://pod.example/alice/inbox/n1.ttl",
        types: [`${AS}Announce`],
        actor: "https://bob.example/profile#me",
        object: "https://pod.example/alice/issues/issues/42.ttl",
        summary: "Bob assigned you issue #42",
        published: "2026-06-15T00:00:00Z",
      },
    ];
    readInbox.mockResolvedValue({ inboxUrl: OWN[0] + "inbox/", notifications });

    render(<InboxView webId={WEBID} ownStorageUrls={OWN} />);

    await waitFor(() => expect(screen.getByText("Bob assigned you issue #42")).toBeTruthy());
    // The activity label + actor host are shown; the actor IRI is not dereferenced.
    expect(screen.getByText("announced")).toBeTruthy();
    expect(screen.getByText(/bob\.example/)).toBeTruthy();
    // readInbox was called with the WebID + own-storage allow-list (SSRF guard).
    expect(readInbox).toHaveBeenCalledWith(WEBID, OWN);
  });

  it("shows the empty state when the profile advertises no own-pod inbox", async () => {
    readInbox.mockResolvedValue({ inboxUrl: undefined, notifications: [] });

    render(<InboxView webId={WEBID} ownStorageUrls={OWN} />);

    await waitFor(() => expect(screen.getByText("No notifications")).toBeTruthy());
    expect(screen.getByText(/doesn't advertise an inbox/)).toBeTruthy();
  });

  it("shows an error state when the read fails", async () => {
    readInbox.mockRejectedValue(new Error("network down"));

    render(<InboxView webId={WEBID} ownStorageUrls={OWN} />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("network down")).toBeTruthy();
  });
});
