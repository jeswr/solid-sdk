// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// DashboardView through the stubbed-fetch seam: rendering (public flagged,
// direct vs inherited), optimistic revoke persisting a real If-Match ACL
// write, and revert-on-failure.
import "@testing-library/jest-dom/vitest";
import { ACL, decide, listRequests, RDF } from "@jeswr/pod-access/requests-solid";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import { toTurtle } from "../../src/lib/rdf.js";
import type { WalkedNode } from "../../src/lib/storage-walk.js";
import { walkStorage } from "../../src/lib/storage-walk.js";
import { DashboardView } from "../../src/ui/DashboardView.jsx";
import { BOB, buildPod, INBOX, OWNER, POD, REQUESTER } from "../fixtures.js";
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

const REPORT = `${POD}docs/report.ttl`;
const REPORT_ACL = `${REPORT}.acl`;

async function seedBlankAcl(pod: PodStub, modes = [ACL.Read, ACL.Write, ACL.Append], copies = 1) {
  const { namedNode, blankNode, quad } = DataFactory;
  const owner = namedNode(`${REPORT_ACL}#owner`);
  const dataset = new Store([
    quad(owner, namedNode(RDF.type), namedNode(ACL.Authorization)),
    quad(owner, namedNode(ACL.agent), namedNode(OWNER)),
    quad(owner, namedNode(ACL.accessTo), namedNode(REPORT)),
    ...[ACL.Read, ACL.Write, ACL.Control].map((mode) =>
      quad(owner, namedNode(ACL.mode), namedNode(mode)),
    ),
  ]);
  for (let i = 0; i < copies; i++) {
    const authorization = blankNode();
    dataset.addQuads([
      quad(authorization, namedNode(RDF.type), namedNode(ACL.Authorization)),
      quad(authorization, namedNode(ACL.agent), namedNode(BOB)),
      quad(authorization, namedNode(ACL.accessTo), namedNode(REPORT)),
      ...modes.map((mode) => quad(authorization, namedNode(ACL.mode), namedNode(mode))),
    ]);
  }
  pod.seed(REPORT_ACL, await toTurtle(dataset));
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

  it("revokes a blank-node grant created by the package after re-reading its ACL", async () => {
    const pod = buildPod();
    const options = { fetch: pod.fetch, webId: OWNER, storage: POD };
    const request = (await listRequests({ ...options, inbox: INBOX }))[0];
    if (!request) throw new Error("missing request");
    await decide(request, { approve: true }, options);
    renderDashboard(pod, await walkAll(pod));
    const row = screen.getByText("/contacts/alice.ttl").closest("li");
    if (!row) throw new Error("missing grant row");
    fireEvent.click(within(row).getByTestId(`revoke-${REQUESTER}`));
    await screen.findByText("Saved");
    const alice = await readEffectiveAcl(`${POD}contacts/alice.ttl`, POD, pod.fetch);
    expect(alice.entries.some((entry) => entry.agents.includes(REQUESTER))).toBe(false);
    expect(
      alice.entries.some(
        (entry) => entry.agents.includes(OWNER) && entry.modes.includes("Control"),
      ),
    ).toBe(true);
    const carol = await readEffectiveAcl(`${POD}contacts/carol.ttl`, POD, pod.fetch);
    expect(carol.entries.some((entry) => entry.agents.includes(REQUESTER))).toBe(true);
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

  it("downgrades a blank-node authorization to Read after a fresh parse, preserving the owner", async () => {
    const pod = buildPod();
    await seedBlankAcl(pod);
    const nodes = await walkAll(pod);
    expect(
      nodes.find((n) => n.url === REPORT)?.entries.find((e) => e.agents.includes(BOB))?.authIri,
    ).toMatch(/^_:/);
    const onChanged = vi.fn();
    renderDashboard(pod, nodes, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Limit to read" }));
    await screen.findByText("Saved");
    const acl = await readEffectiveAcl(REPORT, POD, pod.fetch);
    expect(acl.entries.find((e) => e.agents.includes(BOB))?.modes).toEqual(["Read"]);
    expect(acl.entries.find((e) => e.agents.includes(OWNER))?.modes).toContain("Control");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(pod.log.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([
      REPORT_ACL,
    ]);
  });

  it.each([
    ["changed", "revoke"],
    ["changed", "downgrade"],
    ["ambiguous", "revoke"],
    ["ambiguous", "downgrade"],
  ])("refuses a %s blank-node entry during %s and reverts the optimistic edit", async (change, action) => {
    const pod = buildPod();
    await seedBlankAcl(pod);
    const onChanged = vi.fn();
    renderDashboard(pod, await walkAll(pod), onChanged);
    await seedBlankAcl(
      pod,
      change === "changed" ? [ACL.Read, ACL.Write] : undefined,
      change === "ambiguous" ? 2 : 1,
    );
    const body = pod.body(REPORT_ACL);
    fireEvent.click(
      action === "revoke"
        ? screen.getByTestId(`revoke-${BOB}`)
        : screen.getByRole("button", { name: "Limit to read" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("saving-indicator")).toHaveTextContent(
        "This access entry changed; refresh before editing it.",
      ),
    );
    const row = screen.getByTestId(`revoke-${BOB}`).closest("li");
    if (!row) throw new Error("missing restored row");
    expect(within(row).getByText("Write")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Limit to read" })).toBeInTheDocument();
    expect(pod.body(REPORT_ACL)).toBe(body);
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([
    null,
    'W/"v1"',
  ])("refuses dashboard edits without a strong ETag (%j) and restores the row", async (etag) => {
    const pod = buildPod();
    renderDashboard(pod, await walkAll(pod));
    const body = pod.body(REPORT_ACL);
    pod.intercept = (method, url) =>
      method === "GET" && url === REPORT_ACL
        ? new Response(body, { headers: { "content-type": "text/turtle", ...(etag && { etag }) } })
        : undefined;
    fireEvent.click(screen.getByTestId(`revoke-${BOB}`));
    await waitFor(() =>
      expect(screen.getByTestId("saving-indicator")).toHaveTextContent("strong ETag"),
    );
    expect(screen.getByTestId(`revoke-${BOB}`)).toBeInTheDocument();
    expect(pod.body(REPORT_ACL)).toBe(body);
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
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
