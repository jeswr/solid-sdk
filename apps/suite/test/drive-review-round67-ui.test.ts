// AUTHORED-BY Codex
import { createRequire } from "node:module";
import type AxeBuilder from "@axe-core/playwright";
import { Fragment } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, h, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => new URLSearchParams(),
}));

import { DetailsPane } from "../src/apps/drive/components/details";
import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { DriveError } from "../src/apps/drive/lib/client/client";
import { DriveProvider, useDrive, useFolder } from "../src/apps/drive/state/drive-context";
import {
  DriveUiProvider,
  errorMessage,
  useDriveActions,
  useDriveUi,
} from "../src/apps/drive/state/ui";

// Use the e2e's installed Axe engine without adding a dependency.
const requireSuite = createRequire(import.meta.url);
const axe = createRequire(requireSuite.resolve("@axe-core/playwright"))("axe-core") as {
  setup(node: Node): void;
  teardown(): void;
  commons: {
    text: {
      accessibleText(node: Element): string;
      visible(node: Element): string;
    };
  };
  run(
    node: Element,
    options: Parameters<AxeBuilder["options"]>[0],
  ): ReturnType<AxeBuilder["analyze"]>;
};

let drive: ReturnType<typeof useDrive>;
let ui: ReturnType<typeof useDriveUi>;
let actions: ReturnType<typeof useDriveActions>;

it("round 67: missing captured identity explains how to renew confirmation", () => {
  expect(errorMessage(new DriveError("missing-validator", 428, PRIVATE))).toContain(
    "Refresh and confirm again",
  );
});
function Browser() {
  drive = useDrive();
  ui = useDriveUi();
  actions = useDriveActions();
  const listing = useFolder(PRIVATE);
  return h(
    Fragment,
    null,
    h(FileBrowser, {
      title: "Files",
      folder: PRIVATE,
      items: listing.status === "ready" ? listing.items : undefined,
      columns: [],
      empty: { title: "Empty", icon: null },
    }),
    ui.detailsOpen ? h(DetailsPane, { onClose: () => ui.setDetailsOpen(false) }) : null,
    h(DriveDialogs),
  );
}
async function setup() {
  const f = await rdfPod();
  await f.pod.fetch(`${PRIVATE}secret`, { method: "PUT", body: "1234567890" });
  await f.pod.fetch(`${PRIVATE}other`, { method: "PUT", body: "1234567890" });
  await f.pod.fetch(`${PRIVATE}target/`, { method: "PUT", body: "" });
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const view = await mount(
    h(DriveProvider, { session, children: h(DriveUiProvider, null, h(Browser)) }),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.driveRoot).toBe(DRIVE);
    expect(view.host.querySelector(`[data-url="${PRIVATE}other"]`)).not.toBeNull();
  });
  return { f, view };
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "secret",
  "other",
])("round 67: moved multi-selection Details refreshes every member after queued Replace (%s)", async (name) => {
  const { f, view } = await setup();
  const secret = view.host.querySelector(`[data-url="${PRIVATE}secret"]`);
  const other = view.host.querySelector(`[data-url="${PRIVATE}other"]`);
  if (!secret || !other) throw new Error("Missing rows");
  await click(secret);
  await act(async () => {
    other.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
  });
  await act(async () => ui.setDetailsOpen(true));
  expect(view.host.querySelector(".drv-details")?.textContent).toContain("20 B");
  await act(async () => {
    await actions.move(ui.detailsItems, `${PRIVATE}target/`);
  });
  expect(ui.detailsItems.map(({ url }) => url).sort()).toEqual([
    `${PRIVATE}target/other`,
    `${PRIVATE}target/secret`,
  ]);
  await act(async () =>
    drive.uploads.enqueue(`${PRIVATE}target/`, [new File(["x".repeat(10000)], name)]),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("conflict");
  });
  await act(async () => drive.uploads.resolve(drive.uploads.tasks[0]?.id as string, "replace"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("done");
  });
  expect(await (await f.pod.fetch(`${PRIVATE}target/${name}`)).text()).toHaveLength(10000);
  await vi.waitFor(() =>
    expect(view.host.querySelector(".drv-details")?.textContent).toContain("10 kB"),
  );
});

it("round 67: expanded Move tree items are named only by their own folder", async () => {
  await setup();
  await act(async () =>
    ui.openDialog({ kind: "move", items: [await drive.client.stat(`${PRIVATE}secret`)] }),
  );
  await vi.waitFor(() => expect(document.querySelector(`[data-node="${PRIVATE}"]`)).not.toBeNull());
  const root = document.querySelector(`[data-node="${DRIVE}"]`);
  // An explicit ARIA label takes precedence over descendant text, including groups and twisties.
  expect(root?.getAttribute("aria-label")).toBe("My Drive");
  const expand = document.querySelector('[aria-label="Expand private"]');
  if (!expand) throw new Error("Missing disclosure");
  await click(expand);
  await vi.waitFor(() =>
    expect(document.querySelector(`[data-node="${PRIVATE}target/"]`)).not.toBeNull(),
  );
  expect(document.querySelector(`[data-node="${PRIVATE}"]`)?.getAttribute("aria-label")).toBe(
    "private",
  );
  expect(root?.getAttribute("aria-label")).toBe("My Drive");
  expect(
    document.querySelector(`[data-node="${PRIVATE}target/"]`)?.getAttribute("aria-label"),
  ).toBe("target");
});

it.each([
  false,
  true,
])("round 67 e2e: Move tree names include their visible labels with nested folders expanded=%s", async (expanded) => {
  await setup();
  await act(async () =>
    ui.openDialog({ kind: "move", items: [await drive.client.stat(`${PRIVATE}secret`)] }),
  );
  await vi.waitFor(() => expect(document.querySelector(`[data-node="${PRIVATE}"]`)).not.toBeNull());
  if (expanded) {
    const disclosure = document.querySelector('[aria-label="Expand private"]');
    if (!disclosure) throw new Error("Missing disclosure");
    await click(disclosure);
    await vi.waitFor(() =>
      expect(document.querySelector(`[data-node="${PRIVATE}target/"]`)).not.toBeNull(),
    );
  }
  const tree = document.querySelector('[role="tree"]');
  if (!tree) throw new Error("Missing tree");
  // jsdom has no layout; give the rendered text a nonempty on-screen box.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, 20),
  );
  // Axe's label-content-name-mismatch compares these same text sources. jsdom
  // cannot run its canvas-based icon-font detection; this tree uses SVG icons.
  axe.setup(document);
  try {
    const labels = [...tree.querySelectorAll('[role="treeitem"]')].map((item) => ({
      url: item.getAttribute("data-node"),
      name: axe.commons.text.accessibleText(item),
      visible: axe.commons.text.visible(item),
    }));
    expect(labels).toContainEqual({ url: DRIVE, name: "My Drive", visible: "My Drive" });
    expect(labels).toContainEqual({ url: PRIVATE, name: "private", visible: "private" });
    for (const label of labels) expect(label.name).toBe(label.visible);
  } finally {
    axe.teardown();
  }
  for (const item of tree.querySelectorAll('[role="treeitem"]')) {
    if (item.getAttribute("aria-expanded") !== "true") {
      expect(item.hasAttribute("aria-owns")).toBe(false);
      continue;
    }
    const group = document.getElementById(item.getAttribute("aria-owns") ?? "");
    expect(group?.getAttribute("role")).toBe("group");
    expect(item.contains(group)).toBe(false);
    expect(group?.previousElementSibling).toBe(item);
    expect(group?.querySelector('[role="treeitem"]')).not.toBeNull();
  }
  const result = await axe.run(tree, {
    runOnly: [
      "aria-valid-attr-value",
      "aria-required-children",
      "aria-required-parent",
      "aria-allowed-attr",
      "aria-input-field-name",
      "aria-toggle-field-name",
      "nested-interactive",
    ],
  });
  expect(result.violations).toEqual([]);
  expect(result.incomplete).toEqual([]);
});

it("round 67: queued Replace reports a changed confirmed ACL endpoint and keeps the file", async () => {
  const { f } = await setup();
  await act(async () => drive.uploads.enqueue(PRIVATE, [new File(["replacement"], "secret")]));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("conflict");
  });
  const endpoint = `${PRIVATE}secret-foreign.policy`;
  f.endpoints.set(`${PRIVATE}secret`, endpoint);
  const foreign = await aclBody(`${PRIVATE}secret`, true);
  f.policies.set(endpoint, foreign);
  f.calls.length = 0;
  await act(async () => drive.uploads.resolve(drive.uploads.tasks[0]?.id as string, "replace"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.uploads.tasks[0]?.status).toBe("failed");
  });
  expect(drive.uploads.tasks[0]?.error).toContain("access policy changed");
  expect(await (await f.pod.fetch(`${PRIVATE}secret`)).text()).toBe("1234567890");
  expect(f.policies.get(endpoint)).toBe(foreign);
  expect(f.calls).not.toContainEqual({ url: `${PRIVATE}secret`, method: "PUT" });
});
