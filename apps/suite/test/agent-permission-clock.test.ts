// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Mandate } from "@jeswr/agent-mandate";
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { AGENT } from "@jeswr/agent-mandate/verify";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentClock } from "../src/apps/agent/components/use-agent-clock";
import { useAgentTick } from "../src/apps/agent/lib/hooks";
import { allowSimilar, DAY, proposalBadge } from "../src/apps/agent/lib/mandate-rules";
import { act, h, mount } from "./drive-ui-dom";

afterEach(() => vi.useRealTimers());
it.each([
  "mandate",
  "allowance",
] as const)("updates the badge at the exact %s boundary between five-second ticks", async (kind) => {
  vi.useFakeTimers();
  const start = Date.parse("2026-11-01T12:00:00Z");
  vi.setSystemTime(start);
  const boundary = start + 6200;
  const proposal = {
    ...exampleRecords["action-proposal"],
    intent: { ...exampleRecords["action-proposal"].intent, action: `${AGENT}Remember` },
  };
  const base = defaultMandate({
    id: "urn:mandate",
    ownerWebId: "https://owner.example/#me",
    agentWebId: "https://agent.example/#me",
    recipientHashes: [`sha256:${"a".repeat(64)}`],
    now: new Date(start - DAY),
  });
  const mandate: Mandate =
    kind === "mandate"
      ? {
          ...base,
          validUntil: new Date(boundary).toISOString(),
          autonomous: {
            ...base.autonomous,
            permissions: [{ type: "permission", action: `${AGENT}Remember` }],
          },
        }
      : allowSimilar(base, proposal, "urn:temporary", new Date(boundary - 7 * DAY));
  let observed = 0;
  function Probe() {
    const now = useAgentClock([boundary]);
    observed = now;
    const [badge, setBadge] = useState("");
    useEffect(() => {
      let active = true;
      void proposalBadge(mandate, proposal, new Date(now)).then((value) => {
        if (active) setBadge(value);
      });
      return () => {
        active = false;
      };
    }, [now]);
    return h("span", {}, badge);
  }
  const view = await mount(h(Probe));
  expect(view.host.textContent).toBe("Allowed");
  await act(() => vi.advanceTimersByTime(5000));
  expect(observed).toBe(start + 5000);
  expect(view.host.textContent).toBe("Allowed");
  await act(() => vi.advanceTimersByTime(1199));
  expect(view.host.textContent).toBe("Allowed");
  await act(() => vi.advanceTimersByTime(1));
  expect(observed).toBe(boundary);
  expect(view.host.textContent).toBe("Ask first");
  await view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the workspace tick stable across re-renders between ticks", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-01T12:00:00Z"));
  const seen: number[] = [];
  let rerender: () => void = () => undefined;
  function Probe() {
    const [, setCount] = useState(0);
    rerender = () => setCount((n) => n + 1);
    seen.push(useAgentTick());
    return null;
  }
  const view = await mount(h(Probe));
  await act(() => vi.advanceTimersByTime(1000));
  await act(() => rerender());
  await act(() => vi.advanceTimersByTime(1000));
  await act(() => rerender());
  expect(seen.length).toBeGreaterThanOrEqual(3);
  expect(new Set(seen).size).toBe(1);
  await view.unmount();
});
