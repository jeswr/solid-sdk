// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { issueControlStatement } from "@jeswr/agent-mandate/control";
import { recordToTurtle } from "@jeswr/agent-model";
import { afterEach, expect, it, vi } from "vitest";
import type { Row } from "../src/apps/agent/lib/client";
import { collection, isComplete } from "../src/apps/agent/lib/collections";
import type { Query } from "../src/apps/agent/lib/hooks";
import { AgentWorkspaceProvider } from "../src/apps/agent/lib/hooks";
import type { PendingApproval } from "../src/apps/agent/lib/queue";
import { loadedRecords } from "../src/apps/agent/lib/readers";
import { demoApprovalKey } from "../src/apps/agent/lib/seed";
import { useApprovalQueue } from "../src/apps/agent/lib/use-queue";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/agent/approvals",
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/apps/agent/components/approval-key-setup-sheet", () => ({
  useApprovalDevice: () => ({ requireKey: vi.fn() }),
}));

import { ActivityScreen } from "../src/apps/agent/components/activity";
// Radix reads DOM availability at import time; initialise the harness first.
import { ApprovalsScreen } from "../src/apps/agent/components/approvals";
import { ChatScreen } from "../src/apps/agent/components/chat";
import { InboxScreen } from "../src/apps/agent/components/inbox";
import { AgentSidebar } from "../src/apps/agent/components/sidebar";
import { QueryRows } from "../src/apps/agent/components/states";
import { StatusPill, useDaemonStatus } from "../src/apps/agent/components/status-pill";

// The agent layer guard bans `window.`; components read these as bare globals.
vi.stubGlobal("matchMedia", window.matchMedia);
vi.stubGlobal("location", window.location);
const NOW = Date.parse("2026-11-01T12:00:00Z");
const BASE = `${DEMO_ROOT}agent/`;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
  const listeners = new Set<(url: string) => void>();
  const session: PodSession = {
    mode: "solid",
    publicFetch: pod.fetch,
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
  };
  return {
    session,
    pod,
    emit: (url: string) => {
      for (const listener of listeners) listener(url);
    },
    tree: (children: ReturnType<typeof h>) =>
      h(AgentWorkspaceProvider, { session, children, fallback: () => null }),
  };
}
async function until(condition: () => boolean, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  while (!condition() && performance.now() < deadline)
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  expect(condition()).toBe(true);
}

it("renders URN proposal references as plain text beside supported proposal links", async () => {
  const f = await fixture();
  const url = `${BASE}conversations/welcome/3.ttl`;
  const { recordFromTurtle } = await import("@jeswr/agent-model");
  const record = await recordFromTurtle(await (await f.pod.fetch(url)).text(), url);
  if (record.type !== "conversation-turn") throw new Error("Wrong fixture");
  await f.pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await recordToTurtle({
      ...record,
      refersToProposal: ["urn:test:proposal", `${BASE}proposals/send-reply.ttl`],
    }),
  });
  const view = await mount(f.tree(h(ChatScreen, { id: "welcome" })));
  await until(() =>
    Boolean(view.host.querySelector(".agent-inline-proposal .agent-proposal-link")),
  );
  expect(view.host.textContent).toContain("urn:test:proposal");
  expect(view.host.querySelector(".agent-proposal-link")?.getAttribute("href")).toBe(
    "/agent/approvals/send-reply",
  );
  expect(
    [...view.host.querySelectorAll("a")].some((a) => a.textContent?.includes("urn:test:proposal")),
  ).toBe(false);
  expect(
    [...view.host.querySelectorAll(".agent-inline-proposal button")].map((b) => b.textContent),
  ).toEqual(["Approve", "Change", "Deny"]);
  await view.unmount();
});

it("disables the composer throughout a pending send and shows the model's character limit", async () => {
  const f = await fixture();
  const pending = deferred<void>();
  let saving = false;
  vi.spyOn(f.session, "fetch").mockImplementation(async (url, init) => {
    if (String(url).startsWith(`${BASE}conversations/welcome/`) && init?.method === "PUT") {
      saving = true;
      await pending.promise;
    }
    return f.pod.fetch(url, init);
  });
  const view = await mount(f.tree(h(ChatScreen, { id: "welcome" })));
  await until(() => Boolean(view.host.querySelector(".agent-inline-proposal")));
  const composer = view.host.querySelector<HTMLTextAreaElement>("textarea");
  const form = view.host.querySelector("form");
  const send = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!composer || !form || !send) throw new Error("Missing composer");
  const draft = "a".repeat(16384);
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
      composer,
      draft,
    );
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(composer.maxLength).toBe(16384);
  expect(form.textContent).toContain("16,384 / 16,384 characters");
  await act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await until(() => saving);
  expect(form.getAttribute("aria-busy")).toBe("true");
  // Read-only, not disabled, so the focused control keeps focus during the save.
  expect(composer.readOnly).toBe(true);
  expect(composer.getAttribute("aria-disabled")).toBe("true");
  expect(send.getAttribute("aria-disabled")).toBe("true");
  expect(composer.value).toBe(draft);
  await act(() => pending.resolve());
  await until(() => !composer.readOnly);
  expect(composer.value).toBe("");
  expect(form.getAttribute("aria-busy")).toBe("false");
  await view.unmount();
});

it("debounces each affected Chat container for 300 ms and confines heartbeat changes to status", async () => {
  const f = await fixture();
  const reads = vi.spyOn(f.session, "fetch");
  const view = await mount(
    f.tree(h("div", null, h(AgentSidebar), h(ChatScreen, { id: "welcome" }))),
  );
  await until(() => Boolean(view.host.querySelector(".agent-inline-proposal")));
  reads.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(() => {
    f.emit(`${BASE}proposals/one.ttl`);
    f.emit(`${BASE}proposals/two.ttl`);
  });
  await act(() => vi.advanceTimersByTime(299));
  expect(reads).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(1));
  // The sidebar's waiting count and Chat each have their own scoped query.
  expect(reads.mock.calls.filter(([url]) => String(url) === `${BASE}proposals/`)).toHaveLength(2);
  expect(reads.mock.calls.every(([url]) => String(url).startsWith(`${BASE}proposals/`))).toBe(true);
  reads.mockClear();
  await act(() => f.emit(`${BASE}control/heartbeat.ttl`));
  await act(() => vi.advanceTimersByTime(300));
  expect(reads.mock.calls.length).toBeGreaterThan(0);
  expect(reads.mock.calls.every(([url]) => String(url).startsWith(`${BASE}control/`))).toBe(true);
  await view.unmount();
});

it.each([
  "proposals",
  "approvals",
  "outbox",
])("retries an unreachable %s query for the sidebar and approval queue", async (container) => {
  // The seeded proposals expire relative to NOW, so the queue must read the same clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  let fail = true;
  vi.spyOn(f.session, "fetch").mockImplementation(async (url, init) =>
    fail && String(url) === `${BASE}${container}/`
      ? new Response(null, { status: 403 })
      : f.pod.fetch(url, init),
  );
  let query: Query<Row<PendingApproval>[]> | undefined;
  function Probe() {
    query = useApprovalQueue();
    return null;
  }
  const view = await mount(f.tree(h(Probe)));
  await until(() => query?.status === "error");
  fail = false;
  await act(() => query?.reload());
  await until(() => query?.status === "ready");
  expect(query?.data).toHaveLength(3);
  await view.unmount();
});

it.each([
  "12",
  "4999",
])("restores focus by activity sequence %s, falling back to the timeline heading", async (seq) => {
  const f = await fixture();
  const view = await mount(f.tree(h(ActivityScreen, { seq })));
  await until(() => Boolean(document.querySelector('[role="dialog"] button[aria-label="Close"]')));
  const close = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-label="Close"]',
  );
  if (!close) throw new Error("Missing close button");
  await click(close);
  await view.render(f.tree(h(ActivityScreen)));
  await until(
    () =>
      document.activeElement?.matches(
        seq === "12" ? '.agent-timeline-row[data-seq="12"]' : "#agent-timeline-heading",
      ) === true,
  );
  await view.unmount();
});

it.each([
  "__proto__",
  "constructor",
  "<img src=x onerror=alert(1)>",
])("renders the triage label %s as plain text", async (label) => {
  const f = await fixture();
  // Use the seeded assessment's exact subject/source; only replace the label literal.
  const { loadedRecords, readInbox } = await import("../src/apps/agent/lib/readers");
  const { createAgentClient } = await import("../src/apps/agent/lib/client");
  const client = createAgentClient({ fetch: f.pod.fetch, storage: DEMO_ROOT, workspace: BASE });
  const message = loadedRecords(await readInbox(client, "gmail")).find(
    (m) => m.triage?.primary === "meeting",
  );
  if (!message) throw new Error("Missing triage fixture");
  const url = message.id.replace(/\.ttl$/, ".triage.ttl");
  const body = await (await f.pod.fetch(url)).text();
  await f.pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: body.replace('"meeting"', JSON.stringify(label)),
  });
  const view = await mount(f.tree(h(InboxScreen, { binding: "gmail" })));
  await until(() => Boolean(view.host.textContent?.includes(label)));
  expect(view.host.querySelector(".agent-list img")).toBeNull();
  await view.unmount();
});

it.each([
  "unchanged",
  "reloaded",
  "removed",
])("restores inbox sheet focus after the opener is %s", async (change) => {
  const f = await fixture();
  const view = await mount(f.tree(h(InboxScreen, { binding: "gmail" })));
  await until(() =>
    [...view.host.querySelectorAll("button")].some((b) => b.textContent === "Calendar invitation"),
  );
  const opener = [...view.host.querySelectorAll("button")].find(
    (b) => b.textContent === "Calendar invitation",
  );
  if (!opener) throw new Error("Missing fixture button");
  opener.focus();
  await click(opener);
  await until(() => Boolean(document.querySelector('[role="dialog"]')));
  const id = opener.dataset.agentMessageId as string;
  const findOpener = () =>
    [...view.host.querySelectorAll<HTMLButtonElement>("[data-agent-message-id]")].find(
      (button) => button.dataset.agentMessageId === id,
    );
  if (change !== "unchanged") {
    if (change === "removed") await f.pod.fetch(id, { method: "DELETE" });
    const reload = deferred<void>();
    const io = f.pod.fetch;
    vi.spyOn(f.pod, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === id && change === "reloaded") await reload.promise;
      return io(input, init);
    });
    f.emit(id);
    await until(() => findOpener() !== opener);
    await act(() => reload.resolve());
    if (change === "reloaded") await until(() => Boolean(findOpener()));
    expect(opener.isConnected).toBe(false);
  }
  const close = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-label="Close"]',
  );
  if (!close) throw new Error("Missing sheet close");
  await click(close);
  const target = change === "removed" ? view.host.querySelector("h2") : findOpener();
  await until(() => document.activeElement === target);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await view.unmount();
});

it.each([
  false,
  true,
])("shows collection truncation in the UI only when flagged (%s)", async (truncated) => {
  const view = await mount(
    h(QueryRows, {
      query: {
        status: "ready",
        data: collection([{ url: "test", record: {}, etag: null, verified: "unchecked" }], {
          truncated,
          total: 1000,
          newest: true,
        }),
        reload: () => {},
      },
      empty: "Empty",
      children: () => h("p", {}, "Records"),
    }),
  );
  expect(view.host.textContent?.includes("Showing the newest 1")).toBe(truncated);
  await view.unmount();
});

it("moves visible list focus with arrow keys and isolates genuinely malformed approval rows", async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const f = await fixture();
  const view = await mount(f.tree(h(ApprovalsScreen)));
  await until(() => view.host.querySelectorAll("[data-agent-approval-link]").length === 3);
  expect(view.host.textContent).not.toContain("couldn't be read");
  expect(view.host.textContent).toContain("Expires in 1 day");
  const links = [...view.host.querySelectorAll<HTMLAnchorElement>("[data-agent-approval-link]")];
  const first = links[0];
  if (!first) throw new Error("Missing review link");
  first.focus();
  await key(first, "ArrowDown");
  expect(document.activeElement).toBe(links[1]);
  await key(document.activeElement as Element, "ArrowUp");
  expect(document.activeElement).toBe(first);
  await key(first, "ArrowUp");
  expect(document.activeElement).toBe(links[2]);
  await f.pod.fetch(`${BASE}approvals/bad.trig`, {
    method: "PUT",
    body: "bad",
    headers: { "content-type": "application/trig" },
  });
  f.emit(`${BASE}approvals/bad.trig`);
  await until(() => Boolean(view.host.textContent?.includes("1 record couldn't be read.")));
  expect(view.host.querySelectorAll("[data-agent-approval-link]")).toHaveLength(3);
  await view.unmount();
});

it("keeps the approvals list mounted, with focus, across workspace clock ticks", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  const view = await mount(f.tree(h(ApprovalsScreen)));
  await until(() => view.host.querySelectorAll("[data-agent-approval-link]").length === 3);
  const first = view.host.querySelector<HTMLAnchorElement>("[data-agent-approval-link]");
  if (!first) throw new Error("Missing review link");
  first.focus();
  let skeletons = 0;
  const observer = new MutationObserver(() => {
    if (view.host.querySelector('[aria-label="Loading agent records"]')) skeletons++;
  });
  observer.observe(view.host, { childList: true, subtree: true });
  for (let tick = 0; tick < 3; tick++) {
    await act(() => vi.advanceTimersByTime(5000));
    await until(() => view.host.querySelectorAll("[data-agent-approval-link]").length === 3);
  }
  observer.disconnect();
  expect(skeletons).toBe(0);
  expect(first.isConnected).toBe(true);
  expect(document.activeElement).toBe(first);
  await view.unmount();
  vi.useRealTimers();
});

it("ticks real-session status every five seconds, refreshes on visibility and accepts a newly notified heartbeat", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  function Probe() {
    return h(StatusPill, { status: useDaemonStatus() });
  }
  const view = await mount(f.tree(h(Probe)));
  await until(() => Boolean(view.host.textContent?.includes("Agent running")));
  await act(() => vi.advanceTimersByTime(90_000));
  expect(view.host.textContent).toContain("Agent running");
  await act(() => vi.advanceTimersByTime(5000));
  expect(view.host.textContent).toContain("Agent offline");
  // The old clock lags this heartbeat by four seconds. The notification render
  // must use the current time, even before the next scheduled tick.
  vi.setSystemTime(Date.now() + 4000);
  const url = `${BASE}control/heartbeat.ttl`;
  const body = await (await f.pod.fetch(url)).text();
  await f.pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: body.replace(new Date(NOW - 30_000).toISOString(), new Date(Date.now()).toISOString()),
  });
  f.emit(url);
  await until(() => Boolean(view.host.textContent?.includes("Agent running")));
  vi.setSystemTime(Date.now() + 121_000);
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(view.host.textContent).toContain("Agent offline");
  await view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("recomputes proposal and approval expiry and the sidebar waiting count without pod changes", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  const { recordFromTurtle } = await import("@jeswr/agent-model");
  const proposalUrl = `${BASE}proposals/send-reply.ttl`;
  const proposal = await recordFromTurtle(
    await (await f.pod.fetch(proposalUrl)).text(),
    proposalUrl,
  );
  if (proposal.type !== "action-proposal") throw new Error("Wrong fixture");
  await f.pod.fetch(proposalUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await recordToTurtle({ ...proposal, validUntil: new Date(NOW + 20_000).toISOString() }),
  });
  const approvalUrl = `${BASE}approvals/short.trig`;
  await f.pod.fetch(approvalUrl, {
    method: "PUT",
    headers: { "content-type": "application/trig" },
    body: await issueApproval(
      {
        id: approvalUrl,
        approves: proposal.id,
        termsDigest: proposal.intent.termsDigest,
        decision: "approve",
        expires: new Date(NOW + 7000).toISOString(),
      },
      await demoApprovalKey(),
      new Date(NOW),
    ),
  });
  let rows: PendingApproval[] = [];
  function Probe() {
    const query = useApprovalQueue();
    rows = query.status === "ready" ? loadedRecords(query.data) : [];
    return h("div", null, h(AgentSidebar), h(ChatScreen, { id: "welcome" }));
  }
  const reads = vi.spyOn(f.session, "fetch");
  const view = await mount(f.tree(h(Probe)));
  await until(
    () =>
      rows.find((r) => r.proposal.id === proposal.id)?.state === "approved" &&
      Boolean(view.host.querySelector('[aria-label="2 waiting for approval"]')) &&
      Boolean(
        view.host
          .querySelector(".agent-inline-proposal")
          ?.textContent?.includes("Approved, waiting"),
      ),
  );
  const count = reads.mock.calls.length;
  expect(count).toBeGreaterThan(0);
  await act(() => vi.advanceTimersByTime(10_000));
  expect(rows.find((r) => r.proposal.id === proposal.id)?.state).toBe("pending");
  expect(view.host.querySelector('[aria-label="3 waiting for approval"]')).not.toBeNull();
  expect(view.host.querySelector(".agent-inline-proposal")?.textContent).toContain(
    "Awaiting your approval",
  );
  await act(() => vi.advanceTimersByTime(10_000));
  expect(rows.some((r) => r.proposal.id === proposal.id)).toBe(false);
  expect(view.host.querySelector('[aria-label="2 waiting for approval"]')).not.toBeNull();
  expect(view.host.querySelector(".agent-inline-proposal")?.textContent).toContain(
    "This proposal has expired",
  );
  expect(
    view.host.querySelector<HTMLButtonElement>(".agent-inline-proposal button")?.disabled,
  ).toBe(true);
  expect(reads.mock.calls.length).toBe(count);
  await view.unmount();
  vi.useRealTimers();
});

it("keeps Stopped after 500 unsigned Resumes alongside a verified unexpired Halt", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  const { exampleRecords } = await import("@jeswr/agent-model/testing");
  await f.pod.fetch(`${BASE}control/resume.ttl`, { method: "DELETE" });
  const templateId = "urn:test:unsigned-resume";
  // Halt and Resume are global: binding fields belong to SetBindingState only.
  const {
    restrictions: _restrictions,
    target: _target,
    binding: _binding,
    bindingState: _bindingState,
    ...control
  } = exampleRecords["control-statement"];
  const resume = await recordToTurtle({
    ...control,
    id: templateId,
    kind: "Resume",
    attributedTo: DEMO_WEBID,
    createdAt: new Date(NOW - 1000).toISOString(),
    expires: new Date(NOW + 60000).toISOString(),
  });
  for (let i = 0; i < 500; i++) {
    const url = `${BASE}control/z-${i}.ttl`;
    await f.pod.fetch(url, {
      method: "PUT",
      body: resume.replaceAll(templateId, url),
      headers: { "content-type": "text/turtle" },
    });
  }
  const halt = `${BASE}control/0.trig`;
  await f.pod.fetch(halt, {
    method: "PUT",
    headers: { "content-type": "application/trig" },
    body: await issueControlStatement(
      {
        ...control,
        id: halt,
        kind: "Halt",
        attributedTo: DEMO_WEBID,
        createdAt: new Date(NOW - 2000).toISOString(),
        expires: new Date(NOW + 60000).toISOString(),
      },
      await demoApprovalKey(),
      new Date(NOW - 2000),
    ),
  });
  function Probe() {
    return h(StatusPill, { status: useDaemonStatus() });
  }
  const view = await mount(f.tree(h(Probe)));
  await until(() => Boolean(view.host.textContent?.includes("Stopped")));
  expect(view.host.textContent).not.toContain("Agent running");
  await view.unmount();
});

it("retains a new verified denial after 500 older approvals with larger random UUID names", async () => {
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  await f.pod.fetch(`${BASE}approvals/previous-reply.trig`, { method: "DELETE" });
  const { recordFromTurtle } = await import("@jeswr/agent-model");
  const proposalUrl = `${BASE}proposals/send-reply.ttl`;
  const proposal = await recordFromTurtle(
    await (await f.pod.fetch(proposalUrl)).text(),
    proposalUrl,
  );
  if (proposal.type !== "action-proposal") throw new Error("Wrong fixture");
  const key = await demoApprovalKey();
  for (let i = 0; i < 500; i++) {
    const url = `${BASE}approvals/ffffffff-ffff-4fff-8fff-${String(i).padStart(12, "0")}.trig`;
    await f.pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/trig" },
      body: await issueApproval(
        {
          id: url,
          approves: "urn:older:proposal",
          decision: "approve",
          termsDigest: proposal.intent.termsDigest,
          expires: new Date(NOW + 60000).toISOString(),
        },
        key,
        new Date(NOW - 60000),
      ),
    });
  }
  const denial = `${BASE}approvals/00000000-0000-4000-8000-000000000000.trig`;
  await f.pod.fetch(denial, {
    method: "PUT",
    headers: { "content-type": "application/trig" },
    body: await issueApproval(
      {
        id: denial,
        approves: proposalUrl,
        decision: "deny",
        termsDigest: proposal.intent.termsDigest,
        expires: new Date(NOW + 60000).toISOString(),
      },
      key,
      new Date(NOW - 1000),
    ),
  });
  const view = await mount(f.tree(h(ApprovalsScreen, { id: "send-reply" })));
  await until(() => Boolean(view.host.textContent?.includes("Denied")));
  expect(view.host.textContent).not.toContain("Too many approval records");
  expect(
    [...view.host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Approve",
    )?.disabled,
  ).toBe(true);
  await view.unmount();
});

it.each([
  "control",
  "approvals",
  "outbox",
])("fails closed in the UI above 5,000 %s members", async (path) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  let rows: PendingApproval[] = [];
  let complete = true;
  function Probe() {
    const status = useDaemonStatus();
    const queue = useApprovalQueue();
    if (queue.status === "ready") {
      rows = loadedRecords(queue.data);
      complete = isComplete(queue.data);
    }
    return h("div", {}, h(StatusPill, { status }), h(ApprovalsScreen));
  }
  // A complete approval collection must not settle anything if outbox is incomplete.
  const { recordFromTurtle } = await import("@jeswr/agent-model");
  const proposalUrl = `${BASE}proposals/send-reply.ttl`;
  const proposal = await recordFromTurtle(
    await (await f.pod.fetch(proposalUrl)).text(),
    proposalUrl,
  );
  if (proposal.type !== "action-proposal") throw new Error("Wrong fixture");
  const approvalUrl = `${BASE}approvals/current.trig`;
  await f.pod.fetch(approvalUrl, {
    method: "PUT",
    headers: { "content-type": "application/trig" },
    body: await issueApproval(
      {
        id: approvalUrl,
        approves: proposalUrl,
        decision: "approve",
        termsDigest: proposal.intent.termsDigest,
        expires: new Date(NOW + 60000).toISOString(),
      },
      await demoApprovalKey(),
      new Date(NOW - 1000),
    ),
  });
  const io = f.session.fetch;
  vi.spyOn(f.session, "fetch").mockImplementation(async (input, init) => {
    if (String(input) === `${BASE}${path}/`) {
      const { serialize } = await import("@jeswr/rdf-serialize");
      const { Store } = await import("n3");
      const { metadataNode } = await import("../src/apps/agent/lib/paths");
      const store = new Store();
      const members = metadataNode(store, `${BASE}${path}/`).iris(
        "http://www.w3.org/ns/ldp#contains",
      );
      for (let i = 0; i < 5001; i++) members.add(`${BASE}${path}/${i}.ttl`);
      return new Response(await serialize([...store], { format: "text/turtle" }), {
        headers: { "content-type": "text/turtle" },
      });
    }
    return io(input, init);
  });
  const view = await mount(f.tree(h(Probe)));
  if (path === "control") {
    await until(() => Boolean(view.host.textContent?.includes("Status unknown")));
    expect(view.host.textContent).toContain(
      "Too many control records to check. Check the agent's computer.",
    );
    const trigger = view.host.querySelector<HTMLButtonElement>(
      '[aria-label="Agent status: Status unknown"]',
    );
    if (!trigger) throw new Error("Missing status trigger");
    await act(() =>
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
    );
    await until(() => document.querySelectorAll('[role="menuitem"]').length === 2);
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ).toEqual(["Stop the agent", "Resume"]);
  } else {
    await until(() =>
      Boolean(view.host.textContent?.includes("Too many approval records to check")),
    );
    expect(complete).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === "pending" && !row.approvedAwaitingSend)).toBe(true);
    expect(view.host.textContent).not.toContain("Showing the newest");
  }
  await view.unmount();
});

it("labels unordered display samples honestly", async () => {
  const view = await mount(
    h(QueryRows, {
      query: {
        status: "ready",
        data: collection([], { truncated: true, total: 731 }),
        reload: () => {},
      },
      empty: "Empty",
      children: () => null,
    }),
  );
  expect(view.host.textContent).toContain("Showing 0 of 731");
  expect(view.host.textContent).not.toContain("newest");
  await view.unmount();
});

it("never presents a lower-bound total as exact", async () => {
  const view = await mount(
    h(QueryRows, {
      query: {
        status: "ready",
        data: collection([], { truncated: true, total: 200, totalIsLowerBound: true }),
        reload: () => {},
      },
      empty: "Empty",
      children: () => null,
    }),
  );
  expect(view.host.textContent).toContain(
    "Showing 0. Some accounts weren't checked, so there may be more.",
  );
  expect(view.host.textContent).not.toContain("of 200");
  await view.unmount();
});
