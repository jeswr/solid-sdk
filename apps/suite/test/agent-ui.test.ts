// AUTHORED-BY Codex GPT-6.1-Sol
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { recordToTurtle } from "@jeswr/agent-model";
import { afterEach, expect, it, vi } from "vitest";
import { AgentWorkspaceProvider } from "../src/apps/agent/lib/hooks";
import type { PendingApproval } from "../src/apps/agent/lib/queue";
import { loadedRecords } from "../src/apps/agent/lib/readers";
import { demoApprovalKey } from "../src/apps/agent/lib/seed";
import { useApprovalQueue } from "../src/apps/agent/lib/use-queue";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, key, mount } from "./drive-ui-dom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/agent/approvals",
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("../src/apps/agent/components/approval-key-setup-sheet", () => ({
  useApprovalDevice: () => ({ requireKey: vi.fn() }),
}));

// Radix reads DOM availability at import time; initialise the harness first.
import { ApprovalsScreen } from "../src/apps/agent/components/approvals";
import { ChatScreen } from "../src/apps/agent/components/chat";
import { InboxScreen } from "../src/apps/agent/components/inbox";
import { AgentSidebar } from "../src/apps/agent/components/sidebar";
import { StatusPill, useDaemonStatus } from "../src/apps/agent/components/status-pill";

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
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: async () => {},
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
async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++)
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
  await until(() => Boolean(view.host.textContent?.includes("urn:test:proposal")));
  expect(view.host.querySelector(".agent-proposal-link")?.getAttribute("href")).toBe(
    "/agent/approvals/send-reply",
  );
  expect(
    [...view.host.querySelectorAll("a")].some((a) => a.textContent?.includes("urn:test:proposal")),
  ).toBe(false);
  await view.unmount();
});

it("restores inbox sheet focus to the exact message button that opened it", async () => {
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
  const close = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-label="Close"]',
  );
  if (!close) throw new Error("Missing sheet close");
  await click(close);
  await until(() => document.activeElement === opener);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
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

it("ticks status every five seconds, refreshes on visibility and accepts a newly notified heartbeat", async () => {
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
    return h(AgentSidebar);
  }
  const reads = vi.spyOn(f.session, "fetch");
  const view = await mount(f.tree(h(Probe)));
  await until(
    () =>
      rows.find((r) => r.proposal.id === proposal.id)?.state === "approved" &&
      Boolean(view.host.querySelector('[aria-label="2 waiting for approval"]')),
  );
  const count = reads.mock.calls.length;
  expect(count).toBeGreaterThan(0);
  await act(() => vi.advanceTimersByTime(10_000));
  expect(rows.find((r) => r.proposal.id === proposal.id)?.state).toBe("pending");
  expect(view.host.querySelector('[aria-label="3 waiting for approval"]')).not.toBeNull();
  await act(() => vi.advanceTimersByTime(10_000));
  expect(rows.some((r) => r.proposal.id === proposal.id)).toBe(false);
  expect(view.host.querySelector('[aria-label="2 waiting for approval"]')).not.toBeNull();
  expect(reads.mock.calls.length).toBe(count);
  await view.unmount();
  vi.useRealTimers();
});
