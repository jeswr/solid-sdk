// AUTHORED-BY Codex GPT-6.1-Sol
// Set up the DOM before Radix chooses its browser layout effects.
import "./drive-ui-dom";

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type AxeBuilder from "@axe-core/playwright";
import { buildNanopublications, createFactAssertion, type Fact } from "@jeswr/pkg-memory";
import { beforeEach, expect, it, vi } from "vitest";
import { KnowledgeView } from "../src/apps/health/components/knowledge-view";
import { act, click, h, key, mount } from "./drive-ui-dom";

const session = vi.hoisted(() => ({
  mode: "demo",
  webId: "https://example.org/people/avery#me",
}));
vi.mock("../src/apps/health/state/health-context", () => ({ useHealth: () => ({ session }) }));
const fixture = vi.hoisted(() => ({ small: false }));
vi.mock("@jeswr/pkg-health/testing", async (original) => {
  const actual = await original<typeof import("@jeswr/pkg-health/testing")>();
  return {
    ...actual,
    exampleHealthKnowledge: (...args: Parameters<typeof actual.exampleHealthKnowledge>) =>
      fixture.small ? smallKnowledge() : actual.exampleHealthKnowledge(...args),
  };
});
async function smallKnowledge() {
  const facts: { id: string; fact: Fact }[] = [
    {
      id: "condition",
      fact: {
        template: "condition",
        value: { id: "https://example.org/health/dom-condition", name: "Vitamin D deficiency" },
      },
    },
    {
      id: "allergy",
      fact: {
        template: "allergy",
        value: { id: "https://example.org/health/dom-allergy", name: "Fictional pollen allergy" },
      },
    },
    {
      id: "medication",
      fact: {
        template: "medication",
        value: {
          id: "https://example.org/health/dom-medication",
          medication: {
            id: "https://example.org/health/dom-product",
            name: "Fictional vitamin D supplement",
          },
          dose: { value: "1.00", unit: "tablet", frequency: "daily" },
        },
      },
    },
  ];
  return buildNanopublications(
    {
      batch_id: "fictional-dom-actions",
      worker: {
        agent_id: "https://example.org/agents/fictional-dom",
        agent_label: "Fictional DOM extractor",
      },
      sources: [
        {
          id: "journal",
          kind: "document",
          url: "https://example.org/fictional/dom-journal",
          title: "Fictional DOM journal",
        },
      ],
      claims: facts.map(({ id, fact }) => ({
        id,
        assertion: createFactAssertion(session.webId, fact),
        epistemic: "SelfReportedExplicit",
        categories: ["pd:MedicalHealth"],
        evidence: [{ source: "journal", quote: "Fictional action test evidence." }],
      })),
    },
    { owner: session.webId, generatedAt: "2026-11-01T12:00:00Z" },
  );
}
const requireSuite = createRequire(new URL("../package.json", import.meta.url));
const axe = createRequire(requireSuite.resolve("@axe-core/playwright"))("axe-core") as {
  run(
    node: Element,
    options: Parameters<AxeBuilder["options"]>[0],
  ): ReturnType<AxeBuilder["analyze"]>;
};
beforeEach(() => {
  vi.stubGlobal("matchMedia", window.matchMedia.bind(window));
  vi.stubGlobal("history", window.history);
  vi.stubGlobal("location", window.location);
  vi.stubGlobal("HTMLButtonElement", window.HTMLButtonElement);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  window.history.replaceState(null, "", "/health/knowledge");
  session.mode = "demo";
  fixture.small = false;
});
function element(selector: string, text: string, root: ParentNode = document): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
    (e) => e.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing control: ${text}`);
  return found;
}
async function until(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 30000 },
  );
}
async function tab(label: string) {
  await key(element('[role="tab"]', label), "Enter");
}
async function fill(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function dialog() {
  const node = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!node) throw new Error("Missing fact sheet");
  return node;
}
async function submitCorrection() {
  await act(async () => {
    dialog()
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("renders the full sample on every knowledge tab, filters facts and shows evidence", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed"));
  const view = await mount(h(KnowledgeView));
  await until(() => expect(view.host.textContent).toContain("Fictional sample"));
  for (const label of ["Overview", "Timeline", "Results", "Facts", "Notes"]) {
    await tab(label);
    expect(element('[role="tab"]', label).getAttribute("aria-selected")).toBe("true");
    const result = await axe.run(view.host, {
      runOnly: {
        type: "rule",
        values: [
          "nested-interactive",
          "aria-allowed-role",
          "aria-allowed-attr",
          "button-name",
          "label",
          "aria-required-children",
          "aria-valid-attr-value",
        ],
      },
    });
    expect(result.violations).toEqual([]);
  }
  await tab("Facts");
  await until(() => expect(view.host.querySelectorAll("[data-fact-id]")).toHaveLength(77));
  const belief = view.host.querySelector("fieldset") as Element;
  await click(element("button", "Might", belief));
  await until(() => expect(view.host.querySelectorAll("[data-fact-id]")).toHaveLength(3));
  await click(element("button", "Clear", belief));
  await fill("hlt-knowledge-search", "Vitamin D deficiency");
  expect(view.host.querySelectorAll("[data-fact-id]")).toHaveLength(1);
  await click(view.host.querySelector("[data-fact-id]") as Element);
  expect(dialog().textContent).toContain("Fictional journal entry for condition-current.");
  expect(dialog().textContent).toContain("Fictional demo extractor");
  expect(dialog().textContent).toContain("example-health-avery");
  expect(fetch).not.toHaveBeenCalled();
}, 90000);
it("corrects all supported kinds and forgets a fact while retaining immutable history", async () => {
  fixture.small = true;
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed"));
  const view = await mount(h(KnowledgeView));
  await until(() => expect(view.host.textContent).toContain("Fictional sample"));
  await tab("Facts");
  await fill("hlt-knowledge-search", "Vitamin D deficiency");
  const initial = view.host.querySelector("[data-fact-id]");
  if (!initial) throw new Error("Missing correction fixture");
  await click(initial);
  await click(element("button", "Correct", dialog()));
  await fill("hlt-correction-name", "Fictional DOM correction");
  await fill("hlt-correction-start", "2025-03-03");
  await submitCorrection();
  await until(() =>
    expect(dialog().querySelector(".hlt-knowledge-badge")?.textContent).toBe("Past"),
  );
  await click(element("button", "View replacement: Fictional DOM correction", dialog()));
  expect(dialog().textContent).toContain("3 Mar 2025");
  expect(dialog().textContent).toContain("Correction supplied by the owner.");
  await click(element("button", "Forget", dialog()));
  const confirmation = document.querySelector('[role="alertdialog"]') as Element;
  expect(confirmation.textContent).toContain(
    "Your assistant will stop using this. The history is kept.",
  );
  await click(element("button", "Forget fact", confirmation));
  await until(() =>
    expect(dialog().querySelector(".hlt-knowledge-badge")?.textContent).toBe("Past"),
  );
  await click(dialog().querySelector('button[aria-label="Close"]') as Element);
  for (const [label, medicine] of [
    ["Fictional pollen allergy", false],
    ["Fictional vitamin D supplement", true],
  ] as const) {
    await fill("hlt-knowledge-search", label);
    const fact = view.host.querySelector("[data-fact-id]");
    if (!fact) throw new Error("Missing correction fixture");
    await click(fact);
    await click(element("button", "Correct", dialog()));
    await fill("hlt-correction-name", "Fictional updated record");
    if (medicine) {
      await fill("hlt-correction-dose", "2.50");
      await fill("hlt-correction-unit", "tablet");
    }
    await submitCorrection();
    await until(() =>
      expect(dialog().querySelector(".hlt-knowledge-badge")?.textContent).toBe("Past"),
    );
    await click(element("button", "View replacement: Fictional updated record", dialog()));
    if (medicine) {
      expect(dialog().textContent).toContain("2.50");
      expect(dialog().textContent).toContain("daily");
    }
    await click(dialog().querySelector('button[aria-label="Close"]') as Element);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("opens a fictional local file for a different owner without requests, and explains read-only controls", async () => {
  session.mode = "solid";
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No requests allowed"));
  const view = await mount(h(KnowledgeView));
  expect(view.host.textContent).toContain("Your pod knowledge is coming");
  await fill("hlt-knowledge-owner", "https://example.org/people/robin#me");
  const input = document.getElementById("hlt-knowledge-file") as HTMLInputElement;
  const trig = await readFile(
    new URL("../e2e/health/fixtures/knowledge.trig", import.meta.url),
    "utf8",
  );
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([trig], "knowledge.trig", { type: "application/trig" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await until(() => expect(view.host.textContent).toContain("Local file"));
  await tab("Facts");
  await until(() => expect(view.host.querySelectorAll("[data-fact-id]")).toHaveLength(3));
  const fact = [...view.host.querySelectorAll<HTMLElement>("[data-fact-id]")].find((e) =>
    e.textContent?.includes("Fictional imported pollen allergy"),
  );
  if (!fact) throw new Error("Missing imported fixture");
  await click(fact);
  expect((element("button", "Correct", dialog()) as HTMLButtonElement).disabled).toBe(true);
  expect((element("button", "Forget", dialog()) as HTMLButtonElement).disabled).toBe(true);
  expect(dialog().textContent).toContain("Open it from your pod to make changes");
  expect(dialog().textContent).toContain("Mar 2025");
  expect(fetch).not.toHaveBeenCalled();
});
