// AUTHORED-BY Codex GPT-6.1-Sol
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { type ActionProposal, digestOf, recordToTurtle } from "@jeswr/agent-model";
import { afterEach, expect, it, vi } from "vitest";
import { AgentWorkspaceProvider } from "../src/apps/agent/lib/hooks";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/apps/agent/components/approval-key-setup-sheet", () => ({
  useApprovalDevice: () => ({ requireKey: async (action: () => void) => action() }),
}));
const signing = vi.hoisted(() => ({ signApproval: vi.fn() }));
vi.mock("../src/apps/agent/lib/sign", () => ({ createAgentSigner: () => signing }));

import { ApprovalsScreen } from "../src/apps/agent/components/approvals";
import { ExpiredApprovalRequests } from "../src/apps/agent/components/expired-approvals";
import * as approvalDetails from "../src/apps/agent/lib/approval-details";
import { createAgentClient } from "../src/apps/agent/lib/client";
import { demoApprovalKey } from "../src/apps/agent/lib/seed";

vi.stubGlobal("matchMedia", window.matchMedia);
const NOW = Date.parse("2026-11-01T12:00:00Z");
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture() {
  vi.setSystemTime(NOW);
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
  const listeners = new Set<(url: string) => void>();
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: (input, init) => pod.fetch(input, init),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: async () => {},
  };
  const client = createAgentClient({
    fetch: session.fetch,
    storage: DEMO_ROOT,
    workspace: `${DEMO_ROOT}agent/`,
  });
  const proposal = (
    await client.read(client.paths.resolveSlug("proposals", "send-reply"), "action-proposal")
  ).record;
  return {
    pod,
    client,
    session,
    proposal,
    rewrite: async (proposal: ActionProposal) => {
      const previous = await client.graph(proposal.id);
      await client.replace(proposal.id, await recordToTurtle(proposal), previous.etag as string);
      for (const listener of listeners) listener(proposal.id);
    },
    tree: (children: ReturnType<typeof h>) =>
      h(AgentWorkspaceProvider, { session, children, fallback: () => null }),
  };
}
async function until(condition: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!condition() && performance.now() < deadline)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  expect(condition()).toBe(true);
}
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

it("renders the agent-prepared plain email preview, styles only the footer and copies the digest", async () => {
  const f = await fixture();
  const footer =
    "— Sent by an agent · https://jeswr.org/agent · spec: https://jeswr.org/agentic-web";
  const preview = `Subject: Full preview\nTo: alice@example.test\n\n  <script>literal</script>\nFull body\n\n${footer}`;
  const previous = await f.client.graph(f.proposal.id);
  await f.client.replace(
    f.proposal.id,
    await recordToTurtle({ ...f.proposal, renderedPreview: preview }),
    previous.etag as string,
  );
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  const view = await mount(f.tree(h(ApprovalsScreen, { id: "send-reply" })));
  await until(() => Boolean(view.host.querySelector("pre")));
  expect(view.host.querySelector("pre")?.textContent).toBe(preview);
  expect(view.host.textContent).toContain("Preview prepared by the agent");
  expect(view.host.textContent).toContain("Your approval is tied to this terms digest.");
  const rule = view.host.querySelector('[aria-label="Permission rule"] pre');
  expect(rule?.querySelector("code")?.textContent).toContain('\n  "policy":');
  expect(view.host.textContent).toContain("Asks you first: send messages");
  expect(view.host.querySelector("pre script")).toBeNull();
  expect(view.host.querySelector(".agent-preview-footer")?.textContent).toBe(footer);
  expect(view.host.textContent).toContain("Rule requiring approval:");
  expect(view.host.textContent).not.toContain(
    "Ask before sending to another person or saving a preference",
  );
  await act(() => click(button(view.host, "Copy digest")));
  expect(copy).toHaveBeenCalledWith(f.proposal.intent.termsDigest);
  expect(view.host.textContent).toContain("Digest copied");
  copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await act(() => click(button(view.host, "Copy digest")));
  expect(view.host.textContent).toContain("Couldn't copy the digest");
});

it("shows the canonical remember kind with a brain icon", async () => {
  const f = await fixture();
  const view = await mount(f.tree(h(ApprovalsScreen, { id: "remember-preference" })));
  await until(() => Boolean(view.host.querySelector("pre")));
  expect(view.host.querySelector(".lucide-brain")).not.toBeNull();
  expect(view.host.textContent).toContain("remember");
  expect(view.host.querySelector("pre")?.textContent).toBe(
    "Remember: I prefer afternoon meetings.",
  );
});

it("shows approved waiting immediately, then rolls back if the signed approval cannot be saved", async () => {
  const f = await fixture();
  const saving = deferred<void>();
  signing.signApproval.mockReset();
  signing.signApproval.mockImplementation(() => saving.promise);
  const view = await mount(f.tree(h(ApprovalsScreen, { id: "send-reply" })));
  await until(() => Boolean(view.host.querySelector("pre")));
  await act(() => click(button(view.host, "Approve")));
  await until(() => Boolean(view.host.textContent?.includes("Approved (waiting for agent)")));
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
    "Approved (waiting for agent)",
  );
  expect(view.host.textContent?.match(/Approved/g)).toHaveLength(1);
  expect(button(view.host, "Stop the agent")).toBeDefined();
  await until(() => signing.signApproval.mock.calls.length > 0);
  await act(() => saving.reject(new Error("Write failed")));
  await until(() => Boolean(view.host.textContent?.includes("Couldn't save your decision")));
  await until(() =>
    [...view.host.querySelectorAll<HTMLButtonElement>("button")].some(
      (el) => el.textContent === "Approve" && !el.disabled,
    ),
  );
  expect(view.host.textContent).not.toContain("Approved (waiting for agent)");
});

it("moves an expired request to Activity on the clock without writing audit records", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const f = await fixture();
  const previous = await f.client.graph(f.proposal.id);
  await f.client.replace(
    f.proposal.id,
    await recordToTurtle({ ...f.proposal, validUntil: new Date(NOW + 5000).toISOString() }),
    previous.etag as string,
  );
  const writes = vi.spyOn(f.session, "fetch");
  const view = await mount(f.tree(h("div", null, h(ApprovalsScreen), h(ExpiredApprovalRequests))));
  await until(() => Boolean(view.host.querySelector("[data-agent-approval-id]")));
  expect(view.host.querySelector('[aria-label="Expired approvals"]')).toBeNull();
  await act(() => vi.advanceTimersByTime(5000));
  await until(() => Boolean(view.host.querySelector('[aria-label="Expired approvals"]')));
  expect(view.host.querySelector('[aria-label="Expired approvals"]')?.textContent).toContain(
    "Reason: expired",
  );
  expect(view.host.querySelector(`[data-agent-approval-id="${f.proposal.id}"]`)).toBeNull();
  expect(writes.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  await view.unmount();
});

function checkbox(host: HTMLElement, summary: string) {
  const input = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (el) => el.closest("label")?.textContent?.trim() === `Select ${summary}`,
  );
  if (!input) throw new Error(`Missing selection for ${summary}`);
  return input;
}
function requestRow(host: HTMLElement, summary: string) {
  return checkbox(host, summary).closest("li") as HTMLLIElement;
}
async function secondSend(f: Awaited<ReturnType<typeof fixture>>) {
  const proposal = {
    ...f.proposal,
    id: `${f.client.paths.proposals}second.ttl`,
    intent: {
      ...f.proposal.intent,
      parameters: { ...f.proposal.intent.parameters, summary: "Second request" },
    },
  };
  await f.client.create(proposal.id, await recordToTurtle(proposal));
  return proposal;
}

it("drops a selected digest that changes and signs only the other reviewed terms", async () => {
  const f = await fixture();
  const second = await secondSend(f);
  signing.signApproval.mockReset().mockResolvedValue(undefined);
  const view = await mount(f.tree(h(ApprovalsScreen)));
  await until(() => Boolean(view.host.querySelector('[type="checkbox"]')));
  await click(checkbox(view.host, "Project catch-up"));
  await click(checkbox(view.host, "Second request"));
  expect(button(view.host, "Approve all").disabled).toBe(false);
  const changed = {
    ...f.proposal,
    intent: {
      ...f.proposal.intent,
      termsDigest: digestOf("changed terms"),
    },
  };
  await act(() => f.rewrite(changed));
  await until(() => Boolean(view.host.textContent?.includes("A selected request changed")));
  expect(checkbox(view.host, "Project catch-up").checked).toBe(false);
  expect(checkbox(view.host, "Second request").checked).toBe(true);
  expect(view.host.querySelector('ul[aria-label="Approval requests"] [role="status"]')).toBeNull();
  expect(view.host.querySelector('ul[aria-label="Approval requests"] [aria-live]')).toBeNull();
  expect(view.host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain(
    "Please review it",
  );
  await click(button(view.host, "Approve all"));
  await until(() => signing.signApproval.mock.calls.length === 1);
  expect(signing.signApproval).toHaveBeenCalledWith(second, "approve");
  await until(
    () =>
      Boolean(view.host.querySelector('[type="checkbox"]')) &&
      !checkbox(view.host, "Second request").checked,
  );
  await click(checkbox(view.host, "Project catch-up"));
  await click(button(view.host, "Approve all"));
  await until(() => signing.signApproval.mock.calls.length === 2);
  expect(signing.signApproval).toHaveBeenLastCalledWith(changed, "approve");
});

it("rechecks a later bulk row after an earlier signature finishes", async () => {
  const f = await fixture();
  const second = await secondSend(f);
  const saving = deferred<void>();
  signing.signApproval
    .mockReset()
    .mockImplementationOnce(() => saving.promise)
    .mockResolvedValue(undefined);
  const view = await mount(f.tree(h(ApprovalsScreen)));
  await until(() => Boolean(view.host.querySelector('[type="checkbox"]')));
  await click(checkbox(view.host, "Project catch-up"));
  await click(checkbox(view.host, "Second request"));
  await click(button(view.host, "Approve all"));
  await until(() => signing.signApproval.mock.calls.length === 1);
  // Change the other row directly in the pod, before any notification reaches the UI.
  const firstId = (signing.signApproval.mock.calls[0]?.[0] as ActionProposal | undefined)?.id;
  const other = firstId === second.id ? f.proposal : second;
  const previous = await f.client.graph(other.id);
  await f.client.replace(
    other.id,
    await recordToTurtle({
      ...other,
      intent: {
        ...other.intent,
        termsDigest: digestOf("rewritten during bulk save"),
      },
    }),
    previous.etag as string,
  );
  await act(() => saving.resolve());
  await until(() => Boolean(view.host.textContent?.includes("A selected request changed")));
  expect(signing.signApproval).toHaveBeenCalledTimes(1);
});

it("keeps the previous explanation and labelled rule JSON during a clock re-evaluation", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const f = await fixture();
  const view = await mount(f.tree(h(ApprovalsScreen, { id: "send-reply" })));
  await until(() => Boolean(view.host.querySelector('[aria-label="Permission rule"] pre')));
  const details = view.host.querySelector('[aria-label="Permission rule"] pre')
    ?.textContent as string;
  const original = approvalDetails.approvalExplanation;
  const checking = deferred<approvalDetails.ApprovalExplanation>();
  const explain = vi
    .spyOn(approvalDetails, "approvalExplanation")
    .mockImplementation((policy, proposal, now) =>
      proposal.id === f.proposal.id ? checking.promise : original(policy, proposal, now),
    );
  await act(() => vi.advanceTimersByTime(5000));
  await until(() => explain.mock.calls.some(([, proposal]) => proposal.id === f.proposal.id));
  expect(view.host.textContent).toContain("Your permissions require approval for this action");
  expect(view.host.textContent).toContain("Asks you first: send messages");
  expect(view.host.querySelector('[aria-label="Permission rule"] pre')?.textContent).toBe(details);
  expect(view.host.textContent).not.toContain("Checking your permissions");
  await act(() =>
    checking.resolve({ reason: "Rechecked", rule: "Rechecked rule", ruleDetails: details }),
  );
  await until(() => Boolean(view.host.textContent?.includes("Rechecked rule")));
  const changedCheck = deferred<approvalDetails.ApprovalExplanation>();
  explain.mockImplementation((policy, proposal, now) =>
    proposal.id === f.proposal.id ? changedCheck.promise : original(policy, proposal, now),
  );
  await act(() =>
    f.rewrite({
      ...f.proposal,
      intent: {
        ...f.proposal.intent,
        termsDigest: digestOf("new proposal terms"),
      },
    }),
  );
  await until(() => Boolean(view.host.textContent?.includes("Checking your permissions")));
  expect(view.host.textContent).not.toContain("Rechecked rule");
  expect(view.host.querySelector('[aria-label="Permission rule"] pre')).toBeNull();
  await act(() =>
    changedCheck.resolve({ reason: "Changed terms checked", rule: "Changed terms checked" }),
  );
});

it("clears a settled optimistic entry before an unrelated request starts saving", async () => {
  const f = await fixture();
  await secondSend(f);
  signing.signApproval.mockReset().mockResolvedValueOnce(undefined);
  const view = await mount(f.tree(h(ApprovalsScreen)));
  await until(() => Boolean(view.host.querySelector('[type="checkbox"]')));
  await click(checkbox(view.host, "Project catch-up"));
  await click(button(view.host, "Approve all"));
  await until(() => signing.signApproval.mock.calls.length === 1);
  await until(
    () =>
      Boolean(view.host.querySelector('[type="checkbox"]')) &&
      !checkbox(view.host, "Project catch-up").checked,
  );
  expect(requestRow(view.host, "Project catch-up").textContent).not.toContain("Approved");
  const saving = deferred<void>();
  signing.signApproval.mockImplementationOnce(() => saving.promise);
  await click(checkbox(view.host, "Second request"));
  await click(button(view.host, "Approve all"));
  await until(() =>
    Boolean(requestRow(view.host, "Second request").textContent?.includes("Approved")),
  );
  expect(requestRow(view.host, "Project catch-up").textContent).not.toContain("Approved");
  expect(view.host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe(
    "1 request approved and waiting for the agent.",
  );
  await act(() => saving.resolve());
});

it("shows a verified denial as refused after expiry, even without an outbox record", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const f = await fixture();
  await f.rewrite({ ...f.proposal, validUntil: new Date(NOW + 5000).toISOString() });
  const id = `${f.client.paths.approvals}denied.trig`;
  await f.client.create(
    id,
    await issueApproval(
      {
        id,
        approves: f.proposal.id,
        termsDigest: f.proposal.intent.termsDigest,
        decision: "deny",
        expires: new Date(NOW + 5000).toISOString(),
      },
      await demoApprovalKey(),
      new Date(NOW),
    ),
    "application/trig",
  );
  const view = await mount(f.tree(h(ExpiredApprovalRequests)));
  await until(() => Boolean(view.host.querySelector('[aria-label="Refused approvals"]')));
  await act(() => vi.advanceTimersByTime(5000));
  expect(view.host.querySelector('[aria-label="Refused approvals"]')?.textContent).toContain(
    "Project catch-up",
  );
  expect(view.host.querySelector('[aria-label="Expired approvals"]')).toBeNull();
  expect(
    (await f.client.list(f.client.paths.outbox)).some((row) => row.url.includes("send-reply")),
  ).toBe(false);
  await view.unmount();
  const reopened = await mount(f.tree(h(ExpiredApprovalRequests)));
  await until(() => Boolean(reopened.host.querySelector('[aria-label="Refused approvals"]')));
  expect(reopened.host.querySelector('[aria-label="Expired approvals"]')).toBeNull();
});

it("does not show an expired denial from an unregistered key as a refusal", async () => {
  const f = await fixture();
  await f.rewrite({ ...f.proposal, validUntil: new Date(NOW - 1).toISOString() });
  const id = `${f.client.paths.approvals}unverified-denial.trig`;
  const key = await demoApprovalKey();
  await f.client.create(
    id,
    await issueApproval(
      {
        id,
        approves: f.proposal.id,
        termsDigest: f.proposal.intent.termsDigest,
        decision: "deny",
        expires: new Date(NOW - 1).toISOString(),
      },
      { ...key, verificationMethod: `${DEMO_WEBID}-unregistered-key` },
      new Date(NOW - 5000),
    ),
    "application/trig",
  );
  const view = await mount(f.tree(h(ExpiredApprovalRequests)));
  await until(() => Boolean(view.host.querySelector('[aria-label="Expired approvals"]')));
  expect(view.host.querySelector('[aria-label="Expired approvals"]')?.textContent).toContain(
    "Project catch-up",
  );
  expect(view.host.querySelector('[aria-label="Refused approvals"]')).toBeNull();
});

it("keeps expired approvals invalid in Activity history", async () => {
  const f = await fixture();
  const id = `${f.client.paths.approvals}expired-approval.trig`;
  await f.client.create(
    id,
    await issueApproval(
      {
        id,
        approves: f.proposal.id,
        termsDigest: f.proposal.intent.termsDigest,
        decision: "approve",
        expires: new Date(NOW - 1).toISOString(),
      },
      await demoApprovalKey(),
      new Date(NOW - 5000),
    ),
    "application/trig",
  );
  const history = await approvalDetails.readApprovalHistory(f.client, f.session);
  expect(history.find((row) => row.url === id)).toMatchObject({
    record: { decision: "approve", verification: { invalid: "expired" } },
  });
});
