// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// InboxView: request rendering (requester name, class, purpose, expiry), the
// approve-on-resolved-set preview, the full approve pipeline through the UI,
// deny, malformed-message resilience, and the user-confirmed resume path.
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import { readAccessRequest } from "../../src/lib/inbox.js";
import type { WalkedNode } from "../../src/lib/storage-walk.js";
import { walkStorage } from "../../src/lib/storage-walk.js";
import { readTypeRegistrations, type TypeRegistration } from "../../src/lib/type-index.js";
import { InboxView } from "../../src/ui/InboxView.jsx";
import { buildPod, INBOX, OWNER, POD } from "../fixtures.js";
import type { PodStub } from "../pod-stub.js";

const REQUEST = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;

async function setup(pod: PodStub) {
  const nodes: WalkedNode[] = [];
  for await (const n of walkStorage(POD, pod.fetch)) nodes.push(n);
  const registrations: TypeRegistration[] = await readTypeRegistrations(OWNER, pod.fetch);
  return { nodes, registrations };
}

function renderInbox(
  pod: PodStub,
  nodes: WalkedNode[],
  registrations: TypeRegistration[],
  onChanged = () => {},
) {
  return render(
    <SessionProvider session={{ webId: OWNER, fetch: pod.fetch }}>
      <InboxView
        inboxUrl={INBOX}
        storageRoot={POD}
        registrations={registrations}
        nodes={nodes}
        onChanged={onChanged}
      />
    </SessionProvider>,
  );
}

describe("InboxView", () => {
  it("renders a pending request's fields", async () => {
    const pod = buildPod();
    const { nodes, registrations } = await setup(pod);
    renderInbox(pod, nodes, registrations);
    await screen.findByText("Pending");
    expect(screen.getByText(/your Individual data/)).toBeInTheDocument();
    expect(screen.getByText("Service Provision")).toBeInTheDocument();
    expect(screen.getByText(/2027-01-01/)).toBeInTheDocument();
  });

  it("approve shows the RESOLVED CONCRETE SET before consent, then runs the pipeline", async () => {
    const pod = buildPod();
    const { nodes, registrations } = await setup(pod);
    renderInbox(pod, nodes, registrations);
    fireEvent.click(await screen.findByText("Review & approve…"));

    const preview = await screen.findByTestId("approve-preview");
    expect(preview).toHaveTextContent("/contacts/alice.ttl");
    expect(preview).toHaveTextContent("/contacts/carol.ttl");
    expect(preview).toHaveTextContent(/data added later is NOT included/i);

    fireEvent.click(screen.getByTestId("confirm-approve"));
    await waitFor(async () => {
      const after = await readAccessRequest(REQUEST, pod.fetch);
      expect(after?.status).toBe("Approved");
    });
    // The WAC materialised.
    const effective = await readEffectiveAcl(ALICE, POD, pod.fetch);
    expect(effective.entries.some((e) => e.modes.includes("Read") && e.agents.length > 0)).toBe(
      true,
    );
  });

  it("deny flips the request and writes no ACL", async () => {
    const pod = buildPod();
    const { nodes, registrations } = await setup(pod);
    renderInbox(pod, nodes, registrations);
    fireEvent.click(await screen.findByText("Deny"));
    await waitFor(async () => {
      const after = await readAccessRequest(REQUEST, pod.fetch);
      expect(after?.status).toBe("Denied");
    });
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
  });

  it("a malformed inbox message renders as unparseable without breaking the rest", async () => {
    const pod = buildPod();
    pod.seed(`${INBOX}junk.ttl`, "@@@ definitely not turtle");
    const { nodes, registrations } = await setup(pod);
    renderInbox(pod, nodes, registrations);
    await screen.findByText("Pending"); // the good request still renders
    expect(screen.getByText(/Unparseable message/)).toBeInTheDocument();
  });

  it("an interrupted (Approving) request shows the PINNED targets and a user-confirmed resume", async () => {
    const pod = buildPod();
    const { nodes, registrations } = await setup(pod);

    // Orphan an approval mid-pipeline: crash after the Approving CAS.
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const { approveRequest } = await import("../../src/lib/approval.js");
    pod.intercept = (method, url) =>
      method === "PUT" && url.includes("/grants/")
        ? (() => {
            throw new Error("crash");
          })()
        : undefined;
    await approveRequest(request, {
      ownerWebId: OWNER,
      storageRoot: POD,
      grantsContainer: `${POD}access-manager/grants/`,
      receiptsContainer: `${POD}access-manager/receipts/`,
      fetch: pod.fetch,
      registrations,
      knownResources: nodes.map((n) => n.url),
    }).catch(() => {});
    pod.intercept = undefined;

    renderInbox(pod, nodes, registrations);
    await screen.findByText(/This approval was interrupted/);
    expect(screen.getByText("/contacts/alice.ttl")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Finish approving exactly these"));
    await waitFor(async () => {
      const after = await readAccessRequest(REQUEST, pod.fetch);
      expect(after?.status).toBe("Approved");
    });
  });

  it("explains when the profile has no inbox", () => {
    const pod = buildPod();
    render(
      <SessionProvider session={{ webId: OWNER, fetch: pod.fetch }}>
        <InboxView
          inboxUrl={null}
          storageRoot={POD}
          registrations={[]}
          nodes={[]}
          onChanged={() => {}}
        />
      </SessionProvider>,
    );
    expect(screen.getByText(/no ldp:inbox/)).toBeInTheDocument();
  });
});
