// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// Demo mode renders the REAL four views over the Ada-&-Bex fixture pod:
//   • each ?demo view shows its walkthrough beats (fixtures, not stubs);
//   • WAC inheritance preserves the authorized AGENT: the inherited Read on
//     the health files is attributed to DR. BEX (acl:default on /health/),
//     never transferred to any app;
//   • the Clinic App holds NO active grant — its previous grant was revoked
//     (see history) and its re-request is only PENDING in the inbox, resolving
//     to the CONCRETE file list before approval;
//   • demo actions (Approve / Revoke) are inert: the read-only fetch refuses
//     the write, the UI surfaces the demo message, and nothing changes.
import "@testing-library/jest-dom/vitest";
import { ThemeProvider } from "@jeswr/app-shell";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { DemoApp } from "../../src/demo/DemoApp.jsx";
import { BEX, CLINIC, createDemoSession, DEMO_REQUEST, HEALTH } from "../../src/demo/fixtures.js";
import { Shell } from "../../src/ui/App.jsx";

const FIND = { timeout: 10_000 } as const;

describe("DemoApp — the four ?demo views render the Ada & Bex fixtures", () => {
  it("dashboard: /health/ → Dr. Bex (direct), files inside → Dr. Bex (INHERITED), /profile/card → public; the pending Clinic App appears NOWHERE", async () => {
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

    // acl:default preserves the authorized AGENT: the health files carry Read
    // INHERITED from the folder grant, attributed to DR. BEX — not to any app.
    const bloodRow = (
      await screen.findByText("/health/results/blood.ttl", undefined, FIND)
    ).closest("li");
    if (!bloodRow) throw new Error("blood.ttl row not rendered");
    expect(within(bloodRow).getByTestId(`revoke-${BEX}`)).toBeInTheDocument();
    expect(within(bloodRow).getByText("inherited")).toBeInTheDocument();

    // The Clinic App has NO active grant while its request is pending — it
    // must not show as an authorized agent on ANY resource.
    expect(screen.queryByTestId(`revoke-${CLINIC}`)).not.toBeInTheDocument();
    expect(screen.queryByText("Clinic App")).not.toBeInTheDocument();
  });

  it("dashboard by-agent: Dr. Bex holds /health/ direct + the files inside inherited; the Clinic App holds NOTHING", async () => {
    render(<DemoApp view="dashboard" />);
    await screen.findByText("/health/", undefined, FIND);
    fireEvent.click(screen.getByRole("tab", { name: "By agent" }));
    await screen.findAllByText("Dr. Bex", undefined, FIND);
    expect(screen.getByTestId("public-agent")).toBeInTheDocument();
    // Bex's holding spans the direct folder grant AND the inherited children.
    expect(screen.getAllByText("direct").length).toBeGreaterThan(0);
    expect(screen.getAllByText("inherited").length).toBeGreaterThan(0);
    // No Clinic App holding: a pending request grants nothing.
    expect(screen.queryByTestId(`revoke-${CLINIC}`)).not.toBeInTheDocument();
    expect(screen.queryByText("Clinic App")).not.toBeInTheDocument();
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

  it("history: ONE active grant (Dr. Bex); receipts record the Bex share + the approved-then-REVOKED Clinic grant", async () => {
    render(<DemoApp view="history" />);
    expect(screen.getByRole("tab", { name: "History", selected: true })).toBeInTheDocument();

    // Exactly ONE active grant — Dr. Bex. The Clinic App's grant carries
    // accm:revokedAt, so it is NOT active (a pending re-request grants nothing).
    await screen.findByText("Active grants", undefined, FIND);
    await waitFor(() => expect(screen.getAllByTestId("revoke-grant")).toHaveLength(1), FIND);
    await screen.findAllByText("Dr. Bex", undefined, FIND);
    expect(screen.getByText(/since 2026-06-12/)).toBeInTheDocument();

    // Consent receipts: Granted ×1 (the Bex share) and the Clinic receipt —
    // approved 2026-04-14 (with the recorded 30-day term + purpose), then
    // REVOKED 2026-05-02. Revocation, not expiry, is what ended it: plain WAC
    // has no server-side temporal enforcement.
    expect((await screen.findAllByText("Granted", undefined, FIND)).length).toBe(1);
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(1); // column header + the Clinic row
    expect((await screen.findAllByText("Clinic App", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.getByText("Care Coordination")).toBeInTheDocument();
    expect(screen.getByText("2026-06-12")).toBeInTheDocument(); // Bex share granted
    expect(screen.getByText("2026-04-14")).toBeInTheDocument(); // Clinic approved
    expect(screen.getByText("2026-05-02")).toBeInTheDocument(); // …and revoked on
  });

  it("dataclass: the Health class shows its resolved file set; who has access = Dr. Bex ONLY (the pending Clinic App is NOT an authorized agent)", async () => {
    render(<DemoApp view="dataclass" />);
    expect(screen.getByRole("tab", { name: "Data classes", selected: true })).toBeInTheDocument();

    await screen.findByText("Health", undefined, FIND);
    await waitFor(
      () =>
        expect(screen.getByTestId("summary-Health")).toHaveTextContent(
          "1 other agent(s) can access this data:",
        ),
      FIND,
    );
    // …and that one agent is Dr. Bex (via the inherited folder grant). The
    // Clinic App's request is pending, so it appears in the INBOX only.
    expect((await screen.findAllByText("Dr. Bex", undefined, FIND)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Clinic App")).not.toBeInTheDocument();
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
