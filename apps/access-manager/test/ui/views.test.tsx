// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// DataClassView (grouping + per-class access summary) and HistoryView
// (receipts audit trail + revoke through the UI).
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import { type ApprovalContext, approveRequest } from "../../src/lib/approval.js";
import { readAccessRequest } from "../../src/lib/inbox.js";
import type { WalkedNode } from "../../src/lib/storage-walk.js";
import { walkStorage } from "../../src/lib/storage-walk.js";
import { readTypeRegistrations } from "../../src/lib/type-index.js";
import { DataClassView } from "../../src/ui/DataClassView.jsx";
import { HistoryView } from "../../src/ui/HistoryView.jsx";
import { buildPod, GRANTS, INBOX, OWNER, POD, RECEIPTS, REQUESTER } from "../fixtures.js";
import type { PodStub } from "../pod-stub.js";

async function walkAll(pod: PodStub): Promise<WalkedNode[]> {
  const nodes: WalkedNode[] = [];
  for await (const n of walkStorage(POD, pod.fetch)) nodes.push(n);
  return nodes;
}

function withSession(pod: PodStub, ui: React.ReactNode) {
  return render(
    <SessionProvider session={{ webId: OWNER, fetch: pod.fetch }}>{ui}</SessionProvider>,
  );
}

describe("DataClassView", () => {
  it("groups resources into classes and summarises access", async () => {
    const pod = buildPod();
    const nodes = await walkAll(pod);
    const registrations = await readTypeRegistrations(OWNER, pod.fetch);
    withSession(
      pod,
      <DataClassView
        nodes={nodes}
        registrations={registrations}
        storageRoot={POD}
        walking={false}
      />,
    );
    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByTestId("summary-Individual")).toHaveTextContent(
      "Only you can access this data.",
    );
    expect(screen.getByText(/resource\(s\) outside any data class/)).toBeInTheDocument();
  });

  it("explains when no type indexes exist", () => {
    const pod = buildPod();
    withSession(
      pod,
      <DataClassView nodes={[]} registrations={[]} storageRoot={POD} walking={false} />,
    );
    expect(screen.getByText(/no type indexes/)).toBeInTheDocument();
  });
});

describe("HistoryView", () => {
  async function approveFixture(pod: PodStub) {
    const nodes = await walkAll(pod);
    const registrations = await readTypeRegistrations(OWNER, pod.fetch);
    const request = await readAccessRequest(`${INBOX}request-1.ttl`, pod.fetch);
    if (!request) throw new Error("missing request");
    const ctx: ApprovalContext = {
      ownerWebId: OWNER,
      storageRoot: POD,
      grantsContainer: GRANTS,
      receiptsContainer: RECEIPTS,
      fetch: pod.fetch,
      registrations,
      knownResources: nodes.map((n) => n.url),
      now: () => new Date("2026-07-02T12:00:00Z"),
    };
    return approveRequest(request, ctx);
  }

  it("shows the consent receipt after an approval, then revokes through the UI", async () => {
    const pod = buildPod();
    await approveFixture(pod);
    withSession(pod, <HistoryView storageRoot={POD} onChanged={() => {}} />);

    await screen.findByText("Granted");
    expect(screen.getByText("Active grants")).toBeInTheDocument();
    const revoke = await screen.findByTestId("revoke-grant");

    fireEvent.click(revoke);
    await screen.findByText("Revoked");
    // The WAC was actually retracted from the pinned targets.
    await waitFor(async () => {
      const effective = await readEffectiveAcl(`${POD}contacts/alice.ttl`, POD, pod.fetch);
      expect(effective.entries.some((e) => e.agents.includes(REQUESTER))).toBe(false);
    });
    expect(screen.getByText("No active grants made through this app.")).toBeInTheDocument();
  });

  it("shows empty states with no records", async () => {
    const pod = buildPod();
    withSession(pod, <HistoryView storageRoot={POD} onChanged={() => {}} />);
    await screen.findByText("No active grants made through this app.");
    expect(screen.getByText(/No consent receipts yet/)).toBeInTheDocument();
  });
});
