// AUTHORED-BY Claude Sonnet 5.5
// Set up the DOM before Radix chooses its browser layout effects.
import "./drive-ui-dom";

import type { HealthFact } from "@jeswr/pkg-health";
import { beforeEach, expect, it, vi } from "vitest";
import { KnowledgeResults } from "../src/apps/health/components/knowledge-charts";
import { KnowledgeFacts } from "../src/apps/health/components/knowledge-facts";
import { KnowledgeView } from "../src/apps/health/components/knowledge-view";
import { KnowledgeProvider, useKnowledge } from "../src/apps/health/state/knowledge-context";
import { act, click, h, mount } from "./drive-ui-dom";
import { condition, viewOf } from "./knowledge-fact-fixtures";

const session = vi.hoisted(() => ({
  mode: "solid",
  webId: "https://example.org/people/robin#me",
}));
vi.mock("../src/apps/health/state/health-context", () => ({ useHealth: () => ({ session }) }));
beforeEach(() => {
  vi.stubGlobal("matchMedia", window.matchMedia.bind(window));
  vi.stubGlobal("history", window.history);
  vi.stubGlobal("location", window.location);
  vi.stubGlobal("HTMLButtonElement", window.HTMLButtonElement);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  window.history.replaceState(null, "", "/health/knowledge");
});
const noop = () => {};
const factButtons = (host: Element) => host.querySelectorAll("[data-fact-id]");
function buttonText(host: Element, prefix: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(prefix));
}

it("K1: refuses an oversized local file before reading it, with a value-free message", async () => {
  const view = await mount(h(KnowledgeView));
  const file = new File(["fictional"], "huge.trig", { type: "application/trig" });
  Object.defineProperty(file, "size", { value: 17 * 1024 * 1024 });
  const text = vi.spyOn(file, "text");
  const input = document.getElementById("hlt-knowledge-file") as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(text).not.toHaveBeenCalled();
  const alert = view.host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("larger than 16 MiB");
  expect(alert?.textContent).not.toContain("huge.trig");
  expect(view.host.textContent).not.toContain("Local file");
});

it("K1: shows a page of facts at a time and offers the rest on request", async () => {
  const facts = Array.from({ length: 320 }, (_, i) => condition(i));
  const view = await mount(
    h(KnowledgeFacts, { view: viewOf(facts), query: "", setQuery: noop, onSelect: noop }),
  );
  expect(factButtons(view.host)).toHaveLength(50);
  const more = buttonText(view.host, "Show more facts");
  expect(more?.textContent).toContain("270 remaining");
  await click(more as Element);
  expect(factButtons(view.host)).toHaveLength(100);
});

it("K1: draws a bounded number of result charts", async () => {
  const facts = Array.from(
    { length: 40 },
    (_, i) =>
      ({
        ...condition(i),
        kind: "observation",
        label: `Fictional result ${i}`,
        value: i + 1,
        unit: "mg",
        effectiveTimeMs: Date.UTC(2025, 0, 1 + i),
      }) as HealthFact,
  );
  const view = await mount(h(KnowledgeResults, { view: viewOf(facts), onSelect: noop }));
  expect(view.host.querySelectorAll('section[aria-label$=" results"]')).toHaveLength(10);
  expect(buttonText(view.host, "Show more result charts")).toBeDefined();
});

it("K2: a fact whose later update could not be read is shown with the caveat", async () => {
  const view = await mount(
    h(KnowledgeFacts, {
      view: viewOf([condition(1), condition(2, { affectedBySkipped: true })]),
      query: "",
      setQuery: noop,
      onSelect: noop,
    }),
  );
  const rows = [...factButtons(view.host)];
  expect(rows[0]?.textContent).not.toContain("May be out of date");
  expect(rows[1]?.textContent).toContain("May be out of date");
  expect(rows[1]?.textContent).toContain("A later update to this could not be read");
});

it("K7: the provider reports a refused change instead of resolving as if it worked", async () => {
  const seen: { forget?: (fact: HealthFact) => Promise<boolean> } = {};
  function Probe() {
    seen.forget = useKnowledge().forget;
    return null;
  }
  await mount(h(KnowledgeProvider, { session: session as never, children: h(Probe) }));
  // A solid session has no editable store, so the change is refused.
  expect(await seen.forget?.(condition(1))).toBe(false);
});
