// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// DashboardView through the stubbed-fetch seam: rendering (public flagged,
// direct vs inherited), optimistic revoke persisting a real If-Match ACL
// write, and revert-on-failure.
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import type { WalkedNode } from "../../src/lib/storage-walk.js";
import { walkStorage } from "../../src/lib/storage-walk.js";
import { DashboardView } from "../../src/ui/DashboardView.jsx";
import { BOB, buildPod, OWNER, POD } from "../fixtures.js";
import type { PodStub } from "../pod-stub.js";

async function walkAll(pod: PodStub): Promise<WalkedNode[]> {
  const nodes: WalkedNode[] = [];
  for await (const n of walkStorage(POD, pod.fetch)) nodes.push(n);
  return nodes;
}

function renderDashboard(pod: PodStub, nodes: WalkedNode[], onChanged = () => {}) {
  return render(
    <SessionProvider session={{ webId: OWNER, fetch: pod.fetch }}>
      <DashboardView nodes={nodes} storageRoot={POD} walking={false} onChanged={onChanged} />
    </SessionProvider>,
  );
}

describe("DashboardView", () => {
  it("renders shared resources with the public flag and direct badge", async () => {
    const pod = buildPod();
    renderDashboard(pod, await walkAll(pod));
    expect(screen.getByText("/docs/report.ttl")).toBeInTheDocument();
    expect(screen.getByText("⚠ PUBLIC")).toBeInTheDocument();
    expect(screen.getByTestId("public-agent")).toBeInTheDocument();
    expect(screen.getAllByText("direct").length).toBeGreaterThan(0);
  });

  it("revoking an agent optimistically removes the line AND writes the ACL", async () => {
    const pod = buildPod();
    renderDashboard(pod, await walkAll(pod));
    fireEvent.click(screen.getByTestId(`revoke-${BOB}`));
    // Optimistic: the line is gone immediately; then the pod write lands.
    expect(screen.queryByTestId(`revoke-${BOB}`)).not.toBeInTheDocument();
    await waitFor(async () => {
      const effective = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
      expect(effective.entries.some((e) => e.agents.includes(BOB))).toBe(false);
    });
    await screen.findByText("Saved");
  });

  it("removing public access clears foaf:Agent from the governing ACL", async () => {
    const pod = buildPod();
    renderDashboard(pod, await walkAll(pod));
    fireEvent.click(screen.getByText("Remove public access"));
    await waitFor(async () => {
      const effective = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
      expect(effective.entries.some((e) => e.isPublic)).toBe(false);
    });
    // Bob's named access survives the public removal.
    const effective = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
    expect(effective.entries.some((e) => e.agents.includes(BOB))).toBe(true);
  });

  it("REVERTS the optimistic removal and surfaces the error when the write fails", async () => {
    const pod = buildPod();
    pod.intercept = (method) =>
      method === "PUT" ? new Response("boom", { status: 500 }) : undefined;
    renderDashboard(pod, await walkAll(pod));
    fireEvent.click(screen.getByTestId(`revoke-${BOB}`));
    // The line comes back and the failure is announced.
    await screen.findByTestId(`revoke-${BOB}`);
    expect(screen.getByTestId("saving-indicator")).toHaveTextContent(/failed|412|500|HTTP/i);
    // Pod unchanged.
    const effective = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
    expect(effective.entries.some((e) => e.agents.includes(BOB))).toBe(true);
  });

  it("the by-agent view lists who can see what", async () => {
    const pod = buildPod();
    renderDashboard(pod, await walkAll(pod));
    fireEvent.click(screen.getByRole("tab", { name: "By agent" }));
    expect(screen.getByText("⚠ Anyone on the web")).toBeInTheDocument();
    expect(screen.getAllByText("/docs/report.ttl").length).toBeGreaterThan(0);
  });
});

describe("DashboardView — authenticated-class revoke (roborev regression)", () => {
  it("revoking the any-logged-in line removes the acl:agentClass triple", async () => {
    const pod = buildPod();
    pod.seed(
      `${POD}docs/report.ttl.acl`,
      `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<${POD}docs/report.ttl.acl#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${POD}docs/report.ttl> ; acl:mode acl:Read, acl:Write, acl:Control .
<${POD}docs/report.ttl.acl#auth> a acl:Authorization ;
  acl:agentClass acl:AuthenticatedAgent ;
  acl:accessTo <${POD}docs/report.ttl> ; acl:mode acl:Read .`,
    );
    renderDashboard(pod, await walkAll(pod));
    fireEvent.click(screen.getByTestId("revoke-authenticated"));
    await waitFor(async () => {
      const effective = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
      expect(effective.entries.some((e) => e.isAuthenticated)).toBe(false);
    });
    // Owner access untouched.
    const effective = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
    expect(effective.entries.some((e) => e.agents.includes(OWNER))).toBe(true);
  });
});
