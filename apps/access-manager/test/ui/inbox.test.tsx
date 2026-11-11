// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { parseRdf } from "@jeswr/fetch-rdf";
import { ACCM, decide, listRequests } from "@jeswr/pod-access/requests-solid";
import { LiteralFrom, NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import { listGrants, listReceipts } from "../../src/lib/history.js";
import { toTurtle } from "../../src/lib/rdf.js";
import { InboxView } from "../../src/ui/InboxView.jsx";
import { buildPod, GRANTS, INBOX, OWNER, POD, RECEIPTS, REQUESTER } from "../fixtures.js";
import type { PodStub } from "../pod-stub.js";

const REQUEST = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;
const options = (pod: PodStub) => ({ fetch: pod.fetch, webId: OWNER, storage: POD });
async function entry(pod: PodStub) {
  const request = (await listRequests({ ...options(pod), inbox: INBOX })).find(
    (r) => r.id === REQUEST,
  );
  if (!request) throw new Error("missing request");
  return request;
}
async function claimApproval(pod: PodStub) {
  const dataset = await parseRdf(pod.body(REQUEST) ?? "", "text/turtle", { baseIRI: REQUEST });
  const record = new TermWrapper(REQUEST, dataset, DataFactory);
  OptionalAs.object(record, ACCM.status, ACCM.Approving, NamedNodeFrom.string);
  OptionalAs.object(
    record,
    `${ACCM.ns}snapshot`,
    JSON.stringify({ targets: ["https://evil.example/forged.ttl"] }),
    LiteralFrom.string,
  );
  pod.seed(REQUEST, await toTurtle(dataset));
}
function renderInbox(pod: PodStub, onChanged = () => {}) {
  return render(
    <SessionProvider session={{ webId: OWNER, fetch: pod.fetch }}>
      <InboxView inboxUrl={INBOX} storageRoot={POD} onChanged={onChanged} />
    </SessionProvider>,
  );
}
async function review() {
  const button = await screen.findByText("Review & approve…");
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
async function status(pod: PodStub, expected: string) {
  await waitFor(async () => expect((await entry(pod)).status).toBe(expected));
}

describe("InboxView using requests-solid", () => {
  it("renders notification fields without fetching the requester", async () => {
    const pod = buildPod();
    renderInbox(pod);
    await screen.findByText("Pending");
    expect(screen.getByText(/your Individual data/)).toBeInTheDocument();
    expect(screen.getByText("Service Provision")).toBeInTheDocument();
    expect(screen.getByText(/2027-01-01/)).toBeInTheDocument();
    expect(pod.log.some((call) => call.url.startsWith("https://app.example/"))).toBe(false);
  });

  it("reviews classes, then commits one approval with private records and WAC", async () => {
    const pod = buildPod();
    const onChanged = vi.fn();
    renderInbox(pod, onChanged);
    await review();
    expect(screen.getByTestId("approve-preview")).toHaveTextContent("Individual");
    expect(screen.getByTestId("approve-preview")).toHaveTextContent(
      "Data added later is not included",
    );
    expect(screen.getByTestId("approve-preview")).toHaveTextContent("does not enforce an expiry");
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await status(pod, "approved");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const acl = await readEffectiveAcl(ALICE, POD, pod.fetch);
    expect(acl.entries.some((e) => e.agents.includes(REQUESTER) && e.modes.includes("Read"))).toBe(
      true,
    );
    expect(await listGrants(GRANTS, pod.fetch)).toHaveLength(1);
    expect(await listReceipts(RECEIPTS, pod.fetch)).toHaveLength(1);
    expect(pod.body(`${GRANTS}.acl`)).toContain("recordsKey");
    expect(pod.log.filter((call) => call.method === "PUT" && call.url === REQUEST)).toHaveLength(2);
    expect(pod.log.some((call) => call.url.includes("access-manager/"))).toBe(false);
  });

  it("denies through the package without granting access", async () => {
    const pod = buildPod();
    renderInbox(pod);
    fireEvent.click(await screen.findByText("Deny"));
    await status(pod, "denied");
    await screen.findByText("Saved");
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
    expect(await listGrants(GRANTS, pod.fetch)).toHaveLength(0);
    expect(await listReceipts(RECEIPTS, pod.fetch)).toHaveLength(1);
  });

  it("keeps a malformed message visible without breaking the inbox", async () => {
    const pod = buildPod();
    pod.seed(`${INBOX}junk.ttl`, "@@@ definitely not turtle");
    renderInbox(pod);
    await screen.findByText("Pending");
    expect(screen.getByText(/Unparseable message/)).toBeInTheDocument();
  });

  it("resumes only from private records without resolving the changed Type Index", async () => {
    const pod = buildPod();
    const request = await entry(pod);
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.startsWith(`${GRANTS}grant-`)) throw new Error("interrupted");
      return undefined;
    };
    await expect(decide(request, { approve: true }, options(pod))).rejects.toThrow("interrupted");
    pod.intercept = undefined;
    await claimApproval(pod);
    pod.delete(`${POD}settings/publicTypeIndex.ttl`);
    pod.log.length = 0;
    renderInbox(pod);
    const resume = await screen.findByText("Finish saved approval");
    await waitFor(() => expect(resume).toBeEnabled());
    expect(screen.queryByText(/evil.example/)).not.toBeInTheDocument();
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(resume);
    await status(pod, "approved");
    expect(pod.log.some((call) => call.url.endsWith("publicTypeIndex.ttl"))).toBe(false);
    expect(pod.has(`${ALICE}.acl`)).toBe(true);
  });

  it("refuses a requester-authored Approving snapshot with no owner record", async () => {
    const pod = buildPod();
    await claimApproval(pod);
    renderInbox(pod);
    const resume = await screen.findByText("Finish saved approval");
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await waitFor(() =>
      expect(screen.getByTestId("saving-indicator")).toHaveTextContent("never recorded"),
    );
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    expect(pod.log.some((call) => call.url.startsWith("https://evil.example/"))).toBe(false);
  });

  it.each(["acp", "unknown"])("explains the %s approval refusal", async (model) => {
    const pod = buildPod();
    const { namedNode, quad } = DataFactory;
    const dataset = new Store(
      model === "acp"
        ? [
            quad(
              namedNode(`${POD}.acl`),
              namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
              namedNode("http://www.w3.org/ns/solid/acp#AccessControlResource"),
            ),
          ]
        : [],
    );
    pod.seed(`${POD}.acl`, await toTurtle(dataset));
    renderInbox(pod);
    await screen.findByText("Approving requests isn't available on this storage yet.");
    expect(screen.getByText("Review & approve…")).toBeDisabled();
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
  });

  it("shows a clear refusal when a target uses ACP despite a WAC root", async () => {
    const pod = buildPod();
    renderInbox(pod);
    await review();
    pod.intercept = (method, url) =>
      method === "HEAD" && url === ALICE
        ? new Response(null, {
            status: 200,
            headers: { link: `<${ALICE}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"` },
          })
        : undefined;
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await waitFor(() =>
      expect(screen.getByTestId("saving-indicator")).toHaveTextContent(
        "Approving requests isn't available on this storage yet.",
      ),
    );
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
  });

  it("reports a lost request CAS using the package's winner status", async () => {
    const pod = buildPod();
    renderInbox(pod);
    await review();
    pod.intercept = (method, url) =>
      method === "PUT" && url === REQUEST ? new Response(null, { status: 412 }) : undefined;
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await waitFor(() =>
      expect(screen.getByTestId("saving-indicator")).toHaveTextContent("now pending"),
    );
    expect(pod.log.filter((call) => call.method === "PUT" && call.url === REQUEST)).toHaveLength(1);
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
  });

  it("explains when the profile has no inbox", () => {
    const pod = buildPod();
    render(
      <SessionProvider session={{ webId: OWNER, fetch: pod.fetch }}>
        <InboxView inboxUrl={null} storageRoot={POD} onChanged={() => {}} />
      </SessionProvider>,
    );
    expect(screen.getByText(/no ldp:inbox/)).toBeInTheDocument();
  });
});
