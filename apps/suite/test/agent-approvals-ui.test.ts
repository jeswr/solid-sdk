// AUTHORED-BY Codex GPT-6.1-Sol
import { recordToTurtle } from "@jeswr/agent-model";
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
import { createAgentClient } from "../src/apps/agent/lib/client";

vi.stubGlobal("matchMedia", window.matchMedia);
const NOW = Date.parse("2026-11-01T12:00:00Z");
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture() {
  vi.setSystemTime(NOW);
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: (input, init) => pod.fetch(input, init),
    subscribe: () => () => {},
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

it("renders exact plain email bytes, styles only the footer and copies the digest", async () => {
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
  expect(view.host.textContent).toContain("Approved — the agent will send within a minute");
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
