// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// Demo mode renders the REAL four views over the Ada-&-Bex fixture pod:
//   • each ?demo view shows its walkthrough beats (fixtures, not stubs);
//   • the pending Clinic App request resolves to the CONCRETE file list
//     before approval;
//   • demo actions (Approve / Revoke) are inert: the read-only fetch refuses
//     the write, the UI surfaces the demo message, and nothing changes.
import "@testing-library/jest-dom/vitest";
import { ThemeProvider } from "@jeswr/app-shell";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { DemoApp } from "../../src/demo/DemoApp.jsx";
import { createDemoSession, DEMO_REQUEST, HEALTH } from "../../src/demo/fixtures.js";
import { Shell } from "../../src/ui/App.jsx";

const FIND = { timeout: 10_000 } as const;

describe("DemoApp — the four ?demo views render the Ada & Bex fixtures", () => {
  it("dashboard: /health/ → Dr. Bex (direct), /profile/card → public, health files → Clinic App (inherited)", async () => {
    render(<DemoApp view="dashboard" />);
    expect(screen.getByTestId("demo-banner")).toHaveTextContent(/sample data/i);

    // /health/ shared with Dr. Bex — a DIRECT grant on the folder.
    await screen.findByText("/health/", undefined, FIND);
    expect((await screen.findAllByText("Dr. Bex", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("direct").length).toBeGreaterThan(0);

    // /profile/card is public — flagged prominently.
    expect(screen.getByText("/profile/card")).toBeInTheDocument();
    expect(screen.getByText("⚠ PUBLIC")).toBeInTheDocument();
    expect(screen.getByTestId("public-agent")).toBeInTheDocument();

    // The health files carry the Clinic App's INHERITED folder grant.
    expect(screen.getByText("/health/results/blood.ttl")).toBeInTheDocument();
    expect((await screen.findAllByText("Clinic App", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("inherited").length).toBeGreaterThan(0);
  });

  it("dashboard by-agent: Dr. Bex holds /health/ direct; the Clinic App holds inherited reads", async () => {
    render(<DemoApp view="dashboard" />);
    await screen.findByText("/health/", undefined, FIND);
    fireEvent.click(screen.getByRole("tab", { name: "By agent" }));
    await screen.findAllByText("Dr. Bex", undefined, FIND);
    expect((await screen.findAllByText("Clinic App", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.getByTestId("public-agent")).toBeInTheDocument();
  });

  it("inbox: ONE pending Clinic App request (Read, health data, 30 days, care coordination) that resolves to the concrete file list", async () => {
    render(<DemoApp view="inbox" />);
    // The Requests tab is selected by the ?demo=inbox deep link.
    expect(screen.getByRole("tab", { name: "Requests", selected: true })).toBeInTheDocument();

    await screen.findByText("Pending", undefined, FIND);
    expect((await screen.findAllByText("Clinic App", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.getByText(/your Health data/)).toBeInTheDocument();
    expect(screen.getByText("Care Coordination")).toBeInTheDocument();
    expect(screen.getByText("2026-08-09T00:00:00Z")).toBeInTheDocument();

    // §3.4: approval is on the RESOLVED CONCRETE SET, shown before consent.
    fireEvent.click(await screen.findByText("Review & approve…", undefined, FIND));
    const preview = await screen.findByTestId("approve-preview", undefined, FIND);
    expect(preview).toHaveTextContent("/health/notes.ttl");
    expect(preview).toHaveTextContent("/health/results/blood.ttl");
    expect(preview).toHaveTextContent("/health/results/panel.ttl");
    expect(screen.getByTestId("confirm-approve")).toHaveTextContent("Approve these 3");
  });

  it("history: receipts for the Bex share, the Clinic approval, and the revoked Clinic grant", async () => {
    render(<DemoApp view="history" />);
    expect(screen.getByRole("tab", { name: "History", selected: true })).toBeInTheDocument();

    // Two active grants…
    await screen.findByText("Active grants", undefined, FIND);
    await screen.findAllByText("Dr. Bex", undefined, FIND);
    expect(screen.getByText(/since 2026-06-12/)).toBeInTheDocument();
    expect(screen.getByText(/for Care Coordination/)).toBeInTheDocument();

    // …and three dated consent receipts: Granted ×2, Revoked ×1.
    expect((await screen.findAllByText("Granted", undefined, FIND)).length).toBe(2);
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-06-12")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(screen.getByText("2026-04-14")).toBeInTheDocument(); // revoked receipt created
    expect(screen.getByText("2026-05-02")).toBeInTheDocument(); // …and revoked on
  });

  it("dataclass: the Health class shows its resolved file set and who has access", async () => {
    render(<DemoApp view="dataclass" />);
    expect(screen.getByRole("tab", { name: "Data classes", selected: true })).toBeInTheDocument();

    await screen.findByText("Health", undefined, FIND);
    await waitFor(
      () =>
        expect(screen.getByTestId("summary-Health")).toHaveTextContent(
          "2 other agent(s) can access this data:",
        ),
      FIND,
    );
    expect((await screen.findAllByText("Dr. Bex", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinic App").length).toBeGreaterThan(0);
    // The resolved file set (3 registered health documents).
    fireEvent.click(screen.getByText("3 resource(s)"));
    expect(screen.getByText("/health/results/blood.ttl")).toBeInTheDocument();
    expect(screen.getByText("/health/results/panel.ttl")).toBeInTheDocument();
    expect(screen.getByText("/health/notes.ttl")).toBeInTheDocument();
  });

  it("?demo with no view lands on the dashboard tab", () => {
    render(<DemoApp view="dashboard" />);
    expect(screen.getByRole("tab", { name: "Shared", selected: true })).toBeInTheDocument();
  });
});

describe("DemoApp — actions are inert (read-only fixture pod, no writes)", () => {
  it("approving the request is refused with the demo message and writes NOTHING", async () => {
    const { session, pod } = createDemoSession();
    const before = pod.body(DEMO_REQUEST);
    render(
      <ThemeProvider>
        <SessionProvider session={session}>
          <Shell webId={session.webId} onSignOut={() => undefined} initialTab="inbox" />
        </SessionProvider>
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByText("Review & approve…", undefined, FIND));
    fireEvent.click(await screen.findByTestId("confirm-approve", undefined, FIND));

    // The optimistic flip reverts and the demo refusal surfaces in the UI.
    await waitFor(
      () =>
        expect(screen.getByTestId("saving-indicator")).toHaveTextContent(
          "Demo mode — sample data only; changes are disabled.",
        ),
      FIND,
    );
    await screen.findByText("Pending", undefined, FIND);

    // Ground truth: the fixture never changed and no write ever succeeded.
    expect(pod.body(DEMO_REQUEST)).toBe(before);
    const writes = pod.log.filter((l) => l.method !== "GET" && l.method !== "HEAD");
    expect(writes.length).toBeGreaterThan(0); // the attempt happened…
    expect(writes.every((l) => l.method === "PUT")).toBe(true); // …and every one was thrown at the chokepoint
  });

  it("revoking Dr. Bex on the dashboard is refused and the ACL is untouched", async () => {
    const { session, pod } = createDemoSession();
    const aclBefore = pod.body(`${HEALTH}.acl`);
    render(
      <ThemeProvider>
        <SessionProvider session={session}>
          <Shell webId={session.webId} onSignOut={() => undefined} initialTab="dashboard" />
        </SessionProvider>
      </ThemeProvider>,
    );

    await screen.findByText("/health/", undefined, FIND);
    const revokeButtons = await screen.findAllByTestId(
      "revoke-https://bex.example/profile/card#me",
      undefined,
      FIND,
    );
    const firstRevoke = revokeButtons[0];
    if (!firstRevoke) throw new Error("no revoke button rendered");
    fireEvent.click(firstRevoke);

    await waitFor(
      () =>
        expect(screen.getByTestId("saving-indicator")).toHaveTextContent(
          "Demo mode — sample data only; changes are disabled.",
        ),
      FIND,
    );
    expect(pod.body(`${HEALTH}.acl`)).toBe(aclBefore);
  });
});
