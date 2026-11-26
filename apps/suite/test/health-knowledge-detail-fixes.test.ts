// AUTHORED-BY Claude Sonnet 5.5
// Set up the DOM before Radix chooses its browser layout effects.
import "./drive-ui-dom";

import type { HealthFact } from "@jeswr/pkg-health";
import { beforeEach, expect, it, vi } from "vitest";
import { KnowledgeDetail } from "../src/apps/health/components/knowledge-detail";
import { act, click, h, mount } from "./drive-ui-dom";
import { condition } from "./knowledge-fact-fixtures";

const ctx = vi.hoisted(() => ({
  forget: vi.fn(async () => false),
  correct: vi.fn(async () => false),
  facts: [] as HealthFact[],
}));
vi.mock("../src/apps/health/state/knowledge-context", () => ({
  useKnowledge: () => ({
    data: { source: "demo", owner: "o", view: { facts: ctx.facts } },
    busy: false,
    forget: ctx.forget,
    correct: ctx.correct,
  }),
}));
beforeEach(() => {
  vi.stubGlobal("matchMedia", window.matchMedia.bind(window));
  vi.stubGlobal("HTMLButtonElement", window.HTMLButtonElement);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  ctx.forget.mockClear();
  ctx.correct.mockClear();
});
const noop = () => {};
function dialog(selector = '[role="dialog"]') {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
function control(root: ParentNode, text: string) {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing control: ${text}`);
  return found;
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
async function open(fact: HealthFact) {
  ctx.facts = [fact];
  await mount(h(KnowledgeDetail, { fact, onClose: noop, onSelect: noop }));
}
async function submit() {
  await act(async () => {
    dialog()
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("K7: a refused Forget keeps the dialog open and says so", async () => {
  await open(condition(1));
  await click(control(dialog(), "Forget"));
  await click(control(dialog('[role="alertdialog"]'), "Forget fact"));
  expect(ctx.forget).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(dialog('[role="alertdialog"]').textContent).toContain("This fact changed");
});

it("K7: a refused correction keeps the form open and says so", async () => {
  await open(condition(1));
  await click(control(dialog(), "Correct"));
  await fill("hlt-correction-name", "Fictional renamed condition");
  await submit();
  expect(ctx.correct).toHaveBeenCalledTimes(1);
  expect(dialog().querySelector("form")).not.toBeNull();
  expect(dialog().querySelector('form [role="alert"]')?.textContent).toContain("This fact changed");
});

it("K3: renaming a fact with a recorded dateTime keeps that literal and saves", async () => {
  ctx.correct.mockResolvedValueOnce(true as never);
  await open(condition(1, { period: { start: "2025-03-03T10:00:00Z", end: "2025-04" } }));
  await click(control(dialog(), "Correct"));
  await fill("hlt-correction-name", "Fictional renamed condition");
  await submit();
  expect(ctx.correct).toHaveBeenCalledTimes(1);
  const replacement = (ctx.correct.mock.calls[0] as unknown as [HealthFact, unknown])[1] as {
    value: Record<string, unknown>;
  };
  expect(replacement.value.validFrom).toEqual({
    value: "2025-03-03T10:00:00Z",
    datatype: "dateTime",
  });
  expect(replacement.value.validThrough).toEqual({ value: "2025-04", datatype: "gYearMonth" });
  expect(dialog().querySelector("form")).toBeNull();
});

it("K3: correction is disabled, with a reason, when a date cannot be kept", async () => {
  await open(condition(1, { period: { start: "2025-03-03+01:00" } }));
  expect(control(dialog(), "Correct").disabled).toBe(true);
  expect(dialog().textContent).toContain("would lose data");
});

it("K3: a medication with a non-numeric dose is not rewritten", async () => {
  await open(
    condition(1, {
      kind: "medication",
      label: "Fictional medicine",
      product: { name: "Fictional medicine" },
      dose: { value: "1-2", unit: "tablet" },
    } as never),
  );
  expect(control(dialog(), "Correct").disabled).toBe(true);
  expect(dialog().textContent).toContain("would lose data");
});

it("K5: the sheet does not print epoch milliseconds or internal fields", async () => {
  await open(
    condition(1, {
      period: { start: "2025-03-03", startTime: 1740960000000 },
      affectedBySkipped: true,
    }),
  );
  const text = dialog().textContent ?? "";
  expect(text).not.toContain("1740960000000");
  expect(text).not.toMatch(/Start Time|Effective Time Ms|Affected By Skipped|Corroboration/);
  expect(text).toContain("3 Mar 2025");
});

it("K2: the sheet states that a later update could not be read", async () => {
  await open(condition(1, { affectedBySkipped: true }));
  expect(dialog().textContent).toContain("A later update to this could not be read");
});
