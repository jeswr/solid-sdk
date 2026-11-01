// AUTHORED-BY Codex
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { click, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  client: {},
  changes: { subscribeSubtree: () => () => {} },
  restore: vi.fn(async () => undefined),
  openDialog: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
const entries = ["one", "two"].map((name) => ({
  url: `https://pod.test/drive/.trash/${name}/${name}.txt`,
  original: `https://pod.test/drive/${name}.txt`,
  name: `${name}.txt`,
  trashedAt: new Date("2026-10-30T12:00:00Z"),
  etag: `"${name}"`,
}));
vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => ({
    client: mocks.client,
    driveRoot: "https://pod.test/drive/",
    changes: mocks.changes,
  }),
}));
vi.mock("../src/apps/drive/state/ui", () => ({
  useDriveUi: () => ({ openDialog: mocks.openDialog }),
  useDriveActions: () => ({ restore: mocks.restore }),
  captureDriveFocusRemoval: () => vi.fn(),
}));
vi.mock("../src/apps/drive/lib/operations/operations", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listTrash: async () => entries,
}));

import { TrashView } from "../src/apps/drive/components/views";

afterEach(() => {
  for (const node of document.querySelectorAll("style[data-drive-test]")) node.remove();
  vi.clearAllMocks();
});

function responsiveStyles(width: number) {
  const source = document.createElement("style");
  source.dataset.driveTest = "";
  source.textContent = readFileSync(
    new URL("../src/apps/drive/components/drive.css", import.meta.url),
    "utf8",
  );
  document.head.append(source);
  // jsdom has no viewport layout. Use the real stylesheet's CSSOM to apply
  // exactly the rules the browser selects at this width.
  const active = [...(source.sheet?.cssRules ?? [])].flatMap((rule) => {
    if (!("conditionText" in rule)) return [rule.cssText];
    const media = rule as CSSMediaRule;
    const max = /max-width:\s*(\d+)px/.exec(media.conditionText);
    const min = /min-width:\s*(\d+)px/.exec(media.conditionText);
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
      ? [...media.cssRules].map((child) => child.cssText)
      : [];
  });
  source.textContent = active.join("\n");
}

it.each([
  375, 767, 768, 1024,
])("round 64: Trash bulk commands remain visible and operate on both selected entries at %spx", async (width) => {
  responsiveStyles(width);
  const view = await mount(h(TrashView));
  await vi.waitFor(() =>
    expect(view.host.querySelectorAll('input[type="checkbox"]')).toHaveLength(2),
  );
  for (const checkbox of view.host.querySelectorAll('input[type="checkbox"]'))
    await click(checkbox);
  const toolbar = view.host.querySelector('[aria-label="Trash actions"]');
  expect(getComputedStyle(toolbar as Element).flexWrap).toBe("wrap");
  const restore = [...(toolbar?.querySelectorAll("button") ?? [])].find(
    (node) => node.textContent === "Restore",
  );
  const remove = [...(toolbar?.querySelectorAll("button") ?? [])].find(
    (node) => node.textContent === "Delete for ever",
  );
  if (!restore || !remove) throw new Error("Missing bulk commands");
  for (const button of [restore, remove]) expect(getComputedStyle(button).display).not.toBe("none");
  await click(restore);
  expect(mocks.restore).toHaveBeenCalledWith(entries);
  await click(remove);
  expect(mocks.openDialog).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "delete-forever", entries }),
  );
});
