// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// StoreGrid render test — the catalog grid renders cards, the "Live only" default
// hides not-live apps, search filters, and a live card's Launch is a native <a href>
// carrying ONLY the public WebID (the no-token invariant, asserted at the DOM level).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AppEntry } from "../lib/catalog";
import { StoreGrid } from "./StoreGrid";

const WEBID = "https://alice.solid-test.jeswr.org/profile/card#me";

const APPS: AppEntry[] = [
  {
    id: "pod-drive",
    name: "Pod Drive",
    description: "File browser over Solid LDP containers.",
    category: "Documents",
    deployedUrl: "https://drive.solid-test.jeswr.org",
    status: "live",
    repo: "https://github.com/jeswr/pod-drive",
    launch: "autologin",
  },
  {
    id: "accessradar",
    name: "AccessRadar",
    description: "Accessibility compliance SaaS.",
    category: "Finance",
    deployedUrl: null,
    status: "wip",
    repo: "https://github.com/jeswr/accessradar",
    launch: "none",
  },
];

describe("StoreGrid", () => {
  it("defaults to Live only — hides not-live apps", () => {
    render(<StoreGrid apps={APPS} webId={null} />);
    expect(screen.getByText("Pod Drive")).toBeInTheDocument();
    expect(screen.queryByText("AccessRadar")).not.toBeInTheDocument();
  });

  it("turning off Live only reveals the Coming soon apps", () => {
    render(<StoreGrid apps={APPS} webId={null} />);
    fireEvent.click(screen.getByLabelText(/live only/i));
    expect(screen.getByText("AccessRadar")).toBeInTheDocument();
    // The not-live app shows a Coming soon affordance (status chip + disabled launch
    // placeholder both read "Coming soon"), but NEVER a Launch link.
    const card = screen.getByText("AccessRadar").closest("article") as HTMLElement;
    expect(within(card).getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(1);
    expect(within(card).queryByRole("link", { name: /launch|open/i })).not.toBeInTheDocument();
  });

  it("a live card's Launch is a native <a href> carrying ONLY the public WebID (no token)", () => {
    render(<StoreGrid apps={APPS} webId={WEBID} />);
    const launch = screen.getByRole("link", { name: /launch pod drive/i });
    const href = launch.getAttribute("href") as string;
    expect(href.startsWith("https://drive.solid-test.jeswr.org/#autologin/")).toBe(true);
    expect(href).toContain(encodeURIComponent(WEBID));
    expect(launch).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // No credential material in the rendered href.
    for (const bad of ["access_token", "refresh_token", "id_token", "code=", "Bearer", "eyJ"]) {
      expect(href).not.toContain(bad);
    }
  });

  it("logged out → the live card shows an Open link (the app's own login), no WebID", () => {
    render(<StoreGrid apps={APPS} webId={null} />);
    const open = screen.getByRole("link", { name: /open pod drive/i });
    expect(open).toHaveAttribute("href", "https://drive.solid-test.jeswr.org");
  });

  it("search filters by description token", () => {
    render(<StoreGrid apps={APPS} webId={null} />);
    fireEvent.change(screen.getByLabelText(/search apps/i), {
      target: { value: "container" },
    });
    expect(screen.getByText("Pod Drive")).toBeInTheDocument();
  });
});
