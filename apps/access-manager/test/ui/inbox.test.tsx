// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { parseRdf } from "@jeswr/fetch-rdf";
import { ACCM, decide, FOAF, listRequests, SOLID } from "@jeswr/pod-access/requests-solid";
import { policyToRdf } from "@jeswr/solid-odrl";
import { LiteralFrom, NamedNodeFrom, OptionalAs, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataFactory, Store } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "../../src/auth/SessionContext.js";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import { listGrants, listReceipts } from "../../src/lib/history.js";
import { toTurtle } from "../../src/lib/rdf.js";
import { InboxView } from "../../src/ui/InboxView.jsx";
import {
  buildPod,
  CONTACTS_CLASS,
  GRANTS,
  INBOX,
  OWNER,
  POD,
  RECEIPTS,
  REQUESTER,
} from "../fixtures.js";
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
function renderInbox(pod: PodStub, onChanged = () => {}, webId = OWNER) {
  return render(
    <SessionProvider session={{ webId, fetch: pod.fetch, publicFetch: fetch }}>
      <InboxView inboxUrl={INBOX} storageRoot={POD} onChanged={onChanged} />
    </SessionProvider>,
  );
}
async function review() {
  const button = await screen.findByText("Review & approve…");
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByTestId("confirm-approve")).toBeEnabled());
}
async function status(pod: PodStub, expected: string) {
  await waitFor(async () => expect((await entry(pod)).status).toBe(expected));
}

describe("InboxView using requests-solid", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders fields with a visible requester host when its public profile is unavailable", async () => {
    const pod = buildPod();
    renderInbox(pod);
    await screen.findByText("Pending");
    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText("app.example")).toBeVisible();
    expect(screen.getByText("Service Provision")).toBeInTheDocument();
    expect(screen.getByText(/2027-01-01/)).toBeInTheDocument();
    expect(pod.log.some((call) => call.url.startsWith("https://app.example/"))).toBe(false);
  });

  it("ignores a forged notification name and caches the public profile name with its host", async () => {
    const pod = buildPod();
    const notification = await parseRdf(pod.body(REQUEST) ?? "", "text/turtle", {
      baseIRI: REQUEST,
    });
    OptionalAs.object(
      new TermWrapper(REQUESTER, notification, DataFactory),
      FOAF.name,
      "NHS Clinic",
      LiteralFrom.string,
    );
    pod.seed(REQUEST, await toTurtle(notification));
    const { namedNode, literal, quad } = DataFactory;
    const profile = await toTurtle(
      new Store([quad(namedNode(REQUESTER), namedNode(FOAF.name), literal("Independent reader"))]),
    );
    const publicFetch = vi.mocked(fetch).mockImplementation(async (_input, init) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response(profile, { headers: { "content-type": "text/turtle" } });
    });
    renderInbox(pod);
    const name = await screen.findByText("Independent reader");
    expect(name.parentElement).toHaveTextContent("Independent reader (app.example)");
    expect(screen.queryByText(/NHS Clinic/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Refresh"));
    await screen.findByText("Independent reader");
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(pod.log.some((call) => call.url.startsWith("https://app.example/"))).toBe(false);
  });

  it("keeps public profile names cached across view mounts within a session and refreshes in a new session", async () => {
    const pod = buildPod();
    const { namedNode, literal, quad } = DataFactory;
    const profile = (name: string) =>
      toTurtle(new Store([quad(namedNode(REQUESTER), namedNode(FOAF.name), literal(name))]));
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(await profile("First name"), {
          headers: { "content-type": "text/turtle" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(await profile("Updated name"), {
          headers: { "content-type": "text/turtle" },
        }),
      );
    const session = { webId: OWNER, fetch: pod.fetch, publicFetch: fetch };
    const view = (identity: typeof session) => (
      <SessionProvider session={identity}>
        <InboxView inboxUrl={INBOX} storageRoot={POD} onChanged={() => {}} />
      </SessionProvider>
    );
    const first = render(view(session));
    await screen.findByText("First name");
    first.unmount();
    const second = render(view(session));
    await screen.findByText("First name");
    expect(fetch).toHaveBeenCalledTimes(1);
    second.rerender(view({ ...session }));
    await screen.findByText("Updated name");
    expect(screen.queryByText("First name")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("previews the combined Editor grant when read and write types resolve to the same container", async () => {
    const pod = buildPod();
    const notes = "https://example.org/Notes";
    pod.seed(
      REQUEST,
      await toTurtle(
        new Store(
          policyToRdf({
            id: REQUEST,
            type: "Offer",
            assignee: REQUESTER,
            permissions: [
              { type: "permission", target: CONTACTS_CLASS, action: "read" },
              { type: "permission", target: notes, action: "write" },
            ],
          }),
        ),
      ),
    );
    const indexUrl = `${POD}settings/publicTypeIndex.ttl`;
    const index = await parseRdf(pod.body(indexUrl) ?? "", "text/turtle");
    SetFrom.subjectPredicate(
      new TermWrapper(`${indexUrl}#contacts`, index, DataFactory),
      SOLID.forClass,
      (term) => term.value,
      NamedNodeFrom.string,
    ).add(notes);
    pod.seed(indexUrl, await toTurtle(index));
    renderInbox(pod);
    await review();
    const preview = screen.getByTestId("approve-preview");
    expect(preview.querySelectorAll("li")).toHaveLength(2);
    for (const name of ["alice", "carol"])
      expect(preview).toHaveTextContent(
        `/contacts/${name}.ttl: Can edit (view, add and change) — No expiry`,
      );
    expect(preview).not.toHaveTextContent("Can view");
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await status(pod, "approved");
    const acl = await readEffectiveAcl(ALICE, POD, pod.fetch);
    expect(acl.entries.find((entry) => entry.agents.includes(REQUESTER))?.modes).toEqual([
      "Read",
      "Write",
      "Append",
    ]);
  });

  it("approves with an off-storage owner WebID using only the public transport for that profile", async () => {
    const pod = buildPod();
    const owner = "https://identity.example/profile#me";
    const { namedNode, quad } = DataFactory;
    // Move the owner identity in both the profile and root ACL without changing its storage.
    for (const url of [`${POD}profile/card`, `${POD}.acl`]) {
      const dataset = await parseRdf(pod.body(url) ?? "", "text/turtle", { baseIRI: url });
      const moved = new Store(
        [...dataset].map((q) =>
          quad(
            q.subject.value === OWNER ? namedNode(owner) : q.subject,
            q.predicate,
            q.object.value === OWNER ? namedNode(owner) : q.object,
            q.graph,
          ),
        ),
      );
      pod.seed(url, await toTurtle(moved));
    }
    const publicFetch = vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return url.startsWith("https://identity.example/")
        ? new Response(pod.body(`${POD}profile/card`), {
            headers: { "content-type": "text/turtle" },
          })
        : new Response(null, { status: 404 });
    });
    renderInbox(pod, () => {}, owner);
    await review();
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await status(pod, "approved");
    await screen.findByText("Saved");
    expect(
      publicFetch.mock.calls.some(([input]) =>
        String(input).startsWith("https://identity.example/"),
      ),
    ).toBe(true);
    expect(pod.log.some((call) => call.url.startsWith("https://identity.example/"))).toBe(false);
    const acl = await readEffectiveAcl(ALICE, POD, pod.fetch);
    expect(acl.entries.some((e) => e.agents.includes(REQUESTER) && e.modes.includes("Read"))).toBe(
      true,
    );
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

  it.each([
    "http://192.168.1.1/private/name#me",
    "http://localhost:8080/private/name#me",
    "http://public.example/private/name#me",
    "https://192.168.1.1/private/name#me",
    "https://router.local/private/name#me",
  ])("shows only the host of rejected requester %s without a profile fetch", async (requester) => {
    const pod = buildPod();
    pod.seed(
      REQUEST,
      await toTurtle(
        new Store(
          policyToRdf({
            id: REQUEST,
            type: "Offer",
            assignee: requester,
            permissions: [{ type: "permission", target: CONTACTS_CLASS, action: "read" }],
          }),
        ),
      ),
    );
    renderInbox(pod);
    await screen.findByText("Pending");
    const label = screen.getByTitle(new URL(requester).host);
    expect(label).toHaveTextContent(new URL(requester).host);
    expect(label).not.toHaveTextContent("private/name");
    expect(fetch).not.toHaveBeenCalled();
    expect(pod.log.some((call) => call.url.startsWith(new URL(requester).origin))).toBe(false);
  });

  it("refuses a stale preview before writing, shows the changed targets and requires fresh confirmation", async () => {
    const pod = buildPod();
    const onChanged = vi.fn();
    renderInbox(pod, onChanged);
    await review();
    expect(screen.getByTestId("approve-preview")).toHaveTextContent(
      "/contacts/alice.ttl: Can view",
    );
    const indexUrl = `${POD}settings/publicTypeIndex.ttl`;
    const index = await parseRdf(pod.body(indexUrl) ?? "", "text/turtle");
    const reg = new TermWrapper(`${indexUrl}#contacts`, index, DataFactory);
    OptionalAs.object(reg, SOLID.instanceContainer, undefined, NamedNodeFrom.string);
    OptionalAs.object(reg, SOLID.instance, `${POD}docs/report.ttl`, NamedNodeFrom.string);
    pod.seed(indexUrl, await toTurtle(index));
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await screen.findByText(/Access changed since your review/);
    await waitFor(() => expect(screen.getByTestId("confirm-approve")).toBeEnabled());
    const preview = screen.getByTestId("approve-preview");
    expect(preview).toHaveTextContent("Previous preview");
    expect(preview).toHaveTextContent("/contacts/alice.ttl: Can view");
    expect(preview).toHaveTextContent("Current preview");
    expect(preview).toHaveTextContent("/docs/report.ttl: Can view — No expiry");
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await status(pod, "approved");
    await screen.findByText("Saved");
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
    const acl = await readEffectiveAcl(`${POD}docs/report.ttl`, POD, pod.fetch);
    expect(acl.entries.some((entry) => entry.agents.includes(REQUESTER))).toBe(true);
  });

  it("shows a preview error, prevents approval and permits a read-only retry", async () => {
    const pod = buildPod();
    const indexUrl = `${POD}settings/publicTypeIndex.ttl`;
    const index = pod.body(indexUrl);
    pod.delete(indexUrl);
    renderInbox(pod);
    const review = await screen.findByText("Review & approve…");
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("owner registration");
    expect(screen.getByTestId("confirm-approve")).toBeDisabled();
    fireEvent.click(screen.getByTestId("confirm-approve"));
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    pod.seed(indexUrl, index ?? "");
    fireEvent.click(screen.getByText("Retry preview"));
    await waitFor(() => expect(screen.getByTestId("confirm-approve")).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("approve-preview")).toHaveTextContent(
      "/contacts/alice.ttl: Can view — No expiry",
    );
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
  });

  it("shows the preview's fresh recipient and purpose when the listed request changes", async () => {
    const pod = buildPod();
    renderInbox(pod);
    const reviewButton = await screen.findByText("Review & approve…");
    await waitFor(() => expect(reviewButton).toBeEnabled());
    const requester = "https://updated.example/profile#app";
    pod.seed(
      REQUEST,
      await toTurtle(
        new Store(
          policyToRdf({
            id: REQUEST,
            type: "Offer",
            assignee: requester,
            permissions: [
              {
                type: "permission",
                target: CONTACTS_CLASS,
                action: "read",
                constraints: [
                  {
                    leftOperand: "purpose",
                    operator: "eq",
                    rightOperand: "https://w3id.org/dpv#Research",
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );
    fireEvent.click(reviewButton);
    await waitFor(() => expect(screen.getByTestId("confirm-approve")).toBeEnabled());
    const preview = screen.getByTestId("approve-preview");
    expect(preview).toHaveTextContent("Recipient: updated.example");
    expect(preview).toHaveTextContent("Purpose: Research");
    expect(preview).not.toHaveTextContent("Service Provision");
    fireEvent.click(screen.getByTestId("confirm-approve"));
    await status(pod, "approved");
    const acl = await readEffectiveAcl(ALICE, POD, pod.fetch);
    expect(acl.entries.some((entry) => entry.agents.includes(requester))).toBe(true);
    expect(acl.entries.some((entry) => entry.agents.includes(REQUESTER))).toBe(false);
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
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
    expect(screen.queryByText(/evil.example/)).not.toBeInTheDocument();
    expect(pod.log.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.click(resume);
    await waitFor(() => expect(screen.getByTestId("confirm-approve")).toBeEnabled());
    fireEvent.click(screen.getByTestId("confirm-approve"));
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
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("never recorded"));
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
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
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
      <SessionProvider session={{ webId: OWNER, fetch: pod.fetch, publicFetch: pod.fetch }}>
        <InboxView inboxUrl={null} storageRoot={POD} onChanged={() => {}} />
      </SessionProvider>,
    );
    expect(screen.getByText(/no ldp:inbox/)).toBeInTheDocument();
  });
});
