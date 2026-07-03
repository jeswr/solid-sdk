// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * CommunityLink acceptance (design §3.1 / rail §2): the external-community
 * interstitial appears BEFORE an external link resolves, and both the trigger and
 * the Continue action are safe native anchors (`rel="noopener noreferrer"` +
 * `referrerPolicy="no-referrer"`). No network is touched.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CommunityLinkEntry } from "@/lib/community/communities";
import { CommunityLink, EXTERNAL_COMMUNITY_NOTICE } from "./community-link";

const ENTRY: CommunityLinkEntry = {
  id: "reddit-celiac",
  name: "r/Celiac on Reddit",
  org: "Reddit",
  url: "https://www.reddit.com/r/Celiac/",
  description: "A large peer community.",
  category: "peer-forum",
  moderatedBy: "Reddit volunteer moderators",
};

describe("CommunityLink", () => {
  it("renders a native anchor with safe rel + no-referrer, and does not fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<CommunityLink entry={ENTRY} />);
    const trigger = screen.getByRole("link", { name: /Visit r\/Celiac on Reddit/ });
    expect(trigger.tagName).toBe("A"); // native <a>, never a div/span role=link
    expect(trigger).toHaveAttribute("href", ENTRY.url);
    expect(trigger).toHaveAttribute("rel", "noopener noreferrer");
    expect(trigger).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(trigger).toHaveAttribute("target", "_blank");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("shows the interstitial before resolving; Continue is a safe native anchor", () => {
    render(<CommunityLink entry={ENTRY} />);
    // No interstitial until the user acts.
    expect(screen.queryByText(EXTERNAL_COMMUNITY_NOTICE)).not.toBeInTheDocument();

    const trigger = screen.getByRole("link", { name: /Visit r\/Celiac on Reddit/ });
    fireEvent.click(trigger);

    // The interstitial (an alertdialog) now warns the user BEFORE navigation.
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(EXTERNAL_COMMUNITY_NOTICE)).toBeInTheDocument();

    // The actual navigation is a distinct native anchor with the same safe attrs.
    const cont = screen.getByRole("link", { name: /Continue to Reddit/ });
    expect(cont.tagName).toBe("A");
    expect(cont).toHaveAttribute("href", ENTRY.url);
    expect(cont).toHaveAttribute("rel", "noopener noreferrer");
    expect(cont).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(cont).toHaveAttribute("target", "_blank");
  });

  it("lets the user cancel back to the app", () => {
    render(<CommunityLink entry={ENTRY} />);
    fireEvent.click(screen.getByRole("link", { name: /Visit r\/Celiac on Reddit/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Stay in the app/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("lets a modified click (cmd/ctrl) pass through to the browser without an interstitial", () => {
    render(<CommunityLink entry={ENTRY} />);
    const trigger = screen.getByRole("link", { name: /Visit r\/Celiac on Reddit/ });
    fireEvent.click(trigger, { metaKey: true });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
