// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { AgentWorkspaceProvider } from "../src/apps/agent/lib/hooks";
import { ApprovalKeyStore, setupApprovalKey } from "../src/apps/agent/lib/keys";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, mount } from "./drive-ui-dom";

// Radix reads DOM availability at import time; initialise the harness first.
const { ApprovalDeviceProvider } = await import(
  "../src/apps/agent/components/approval-key-setup-sheet"
);
const { SettingsScreen } = await import("../src/apps/agent/components/settings");

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++)
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  expect(condition()).toBe(true);
}
it("shows the active key's state after a failed replacement and when device storage changes", async () => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", window.matchMedia);
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  let fail = false;
  const session: PodSession = {
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: "Alice",
    mode: "demo",
    fetch: async (input, init) =>
      fail && init?.method === "PUT" ? new Response(null, { status: 403 }) : pod.fetch(input, init),
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(
    h(AgentWorkspaceProvider, {
      session,
      fallback: () => null,
      children: h(ApprovalDeviceProvider, { children: h(SettingsScreen) }),
    }),
  );
  await until(() => Boolean(view.host.textContent?.includes("No key")));
  await act(async () => {
    await setupApprovalKey(session);
  });
  await act(() => window.dispatchEvent(new Event("storage")));
  await until(() => Boolean(view.host.textContent?.includes("Key ready")));
  const old = localStorage.getItem("agent.approvalKey") as string;
  const replace = [...view.host.querySelectorAll("button")].find(
    (b) => b.textContent === "Set up a new key",
  );
  if (!replace) throw new Error("Missing replacement button");
  await click(replace);
  await until(() => Boolean(document.querySelector('[role="dialog"]')));
  const setup = [...document.querySelectorAll('[role="dialog"] button')].find(
    (b) => b.textContent === "Set up this device",
  );
  if (!setup) throw new Error("Missing setup button");
  fail = true;
  await click(setup);
  await until(() => Boolean(document.querySelector('[role="dialog"] [role="alert"]')));
  const close = [...document.querySelectorAll('[role="dialog"] button')].find(
    (b) => b.textContent === "Not now",
  );
  if (!close) throw new Error("Missing close button");
  await click(close);
  await until(() => Boolean(view.host.textContent?.includes("Key ready")));
  expect(localStorage.getItem("agent.approvalKey")).toBe(old);
  await act(async () => {
    await new ApprovalKeyStore().delete(old);
  });
  await act(() => window.dispatchEvent(new Event("storage")));
  await until(() => Boolean(view.host.textContent?.includes("This device cannot approve")));
  await view.unmount();
});
