// AUTHORED-BY Codex GPT-6
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { click, h, mount } from "./drive-ui-dom";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    h("a", { href }, children),
}));

import { PermissionAccessRow } from "../src/apps/home/components/permissions/permission-access";
import type { AgentRow } from "../src/apps/home/lib/permissions";
import type { PermissionsBinding } from "../src/apps/home/state/permissions";

vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);

const row: AgentRow = {
  key: "bob",
  id: "https://bob.test/card#me",
  kind: "person",
  name: "Bob",
  lines: [
    {
      key: "files",
      dataType: { id: "files", label: "Files" },
      domainId: "documents",
      resources: [
        {
          url: "https://pod.test/drive/Work/",
          isContainer: true,
          modes: ["read"],
          inherited: false,
          source: "https://pod.test/drive/Work/.acl",
          node: "urn:bob",
          system: "wac",
        },
      ],
      role: "viewer",
      modes: ["read"],
      inherited: false,
    },
  ],
};
function binding(): PermissionsBinding {
  return {
    status: "ready",
    rows: [row],
    failures: [],
    truncated: false,
    removed: {},
    busy: false,
    online: true,
    clients: {},
    refresh: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    undo: vi.fn(async () => {}),
    collapse: vi.fn(),
  };
}

it("adapts the real shared row with a native detail link, labelled line, Advanced path and gated grant", async () => {
  const state = binding();
  const view = await mount(
    h(PermissionAccessRow, {
      row,
      binding: state,
      storage: "https://pod.test/",
      view: "advanced",
      technical: false,
    }),
  );
  const article = view.host.querySelector("article");
  expect(article?.getAttribute("aria-label")).toBe("Access for Bob");
  expect(article?.querySelector("a")?.textContent).toBe("Bob");
  const trigger = view.host.querySelector<HTMLButtonElement>(".su-permission-trigger");
  if (!trigger) throw new Error("Missing permission header");
  await click(trigger);
  const region = document.getElementById(trigger.getAttribute("aria-controls") || "");
  expect(region?.hidden).toBe(false);
  const toggle = region?.querySelector<HTMLButtonElement>(".hm-permission-line [role=switch]");
  expect(toggle?.getAttribute("aria-label")).toBe("Files for Bob");
  expect(region?.querySelector("code")?.textContent).toBe("drive/Work/");
  expect(region?.querySelector(".hm-permission-chip")?.textContent).toBe("Read");
  expect(region?.querySelector<HTMLButtonElement>(".hm-permission-path button")?.disabled).toBe(
    true,
  );
  if (!toggle) throw new Error("Missing line toggle");
  await click(toggle);
  expect(state.revoke).toHaveBeenCalledWith(row.lines[0]);
});

it("keeps inherited toggles behind the parent-name confirmation and restores keyboard focus", async () => {
  const state = binding();
  const inherited = {
    ...row,
    lines: row.lines.map((line) => ({
      ...line,
      inherited: true,
      resources: line.resources.map((r) => ({
        ...r,
        inherited: true,
        inheritedFrom: "https://pod.test/drive/Work/",
      })),
    })),
  };
  const view = await mount(
    h(PermissionAccessRow, {
      row: inherited,
      binding: state,
      storage: "https://pod.test/",
      view: "overview",
      technical: false,
      alwaysExpanded: true,
    }),
  );
  const toggle = view.host.querySelector<HTMLButtonElement>(".hm-permission-line [role=switch]");
  if (!toggle) throw new Error("Missing line toggle");
  await click(toggle);
  expect(state.revoke).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog?.textContent).toContain("This changes access for everything in Work");
  const confirm = [...(dialog?.querySelectorAll("button") || [])].find(
    (button) => button.textContent === "Remove access",
  );
  if (!confirm) throw new Error("Missing inherited confirmation");
  await click(confirm);
  expect(state.revoke).toHaveBeenCalledWith(inherited.lines[0]);
});
