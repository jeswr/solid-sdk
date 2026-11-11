// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { type ReactNode, useState } from "react";
import { expect, it, vi } from "vitest";
import { act, click, h, key, mount } from "./drive-ui-dom";

vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => ({}) }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => h("a", { href, className }, children),
}));

import { ClientCard } from "../src/apps/home/components/permissions/agent-page";
import { PermissionAccessRow } from "../src/apps/home/components/permissions/permission-access";
import {
  PermissionNotices,
  RequestsLink,
} from "../src/apps/home/components/permissions/permissions-page";
import {
  type AgentRow,
  aggregateHoldings,
  type WalkedAccess,
} from "../src/apps/home/lib/permissions";
import type { PermissionsBinding } from "../src/apps/home/state/permissions";
import { DEMO_ROOT } from "../src/lib/demo-pod/constants";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  DEMO_APP_CLIENT_ID,
  DEMO_APP_LOGO,
  seedPermissionApp,
} from "../src/lib/demo-pod/seed-permission-app";

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

it.each([
  false,
  true,
])("labels only unequal folder scopes in the shared list/detail renderer (expanded=%s)", async (alwaysExpanded) => {
  const folder = "https://pod.test/drive/Work/";
  const own: WalkedAccess = {
    url: folder,
    isContainer: true,
    inherited: false,
    system: "wac",
    policy: {
      denials: [],
      grants: [
        {
          who: [[{ kind: "agent", webId: row.id }]],
          except: [],
          modes: new Set(["read"]),
          appliesTo: "resource",
          source: { url: `${folder}.acl`, node: "own" },
        },
        {
          who: [[{ kind: "agent", webId: row.id }]],
          except: [],
          modes: new Set(["write"]),
          appliesTo: "members",
          source: { url: `${folder}.acl`, node: "members" },
        },
      ],
    },
  };
  for (const shape of ["split", "merged", "file", "ancestor"] as const) {
    const nodes: WalkedAccess[] =
      shape === "ancestor"
        ? [
            {
              ...own,
              inherited: true,
              inheritedFrom: "https://pod.test/drive/",
              policy: {
                denials: [],
                grants: [own.policy.grants[1] as WalkedAccess["policy"]["grants"][number]],
              },
            },
          ]
        : [
            {
              ...own,
              url: shape === "file" ? `${folder}report.pdf` : folder,
              isContainer: shape !== "file",
              policy: {
                denials: [],
                grants:
                  shape === "split"
                    ? own.policy.grants
                    : [
                        {
                          ...(own.policy.grants[0] as WalkedAccess["policy"]["grants"][number]),
                          appliesTo: shape === "file" ? "resource" : "both",
                        },
                      ],
              },
            },
          ];
    const holding = aggregateHoldings(nodes, {
      webId: "https://pod.test/profile#me",
      classify: () => undefined,
    }).rows[0];
    if (!holding) throw new Error("Missing scoped holding");
    const person = {
      ...holding,
      name: "Bob",
    };
    const state = binding();
    const view = await mount(
      h(PermissionAccessRow, {
        row: person,
        binding: state,
        storage: "https://pod.test/",
        view: "overview",
        technical: false,
        alwaysExpanded,
      }),
    );
    if (!alwaysExpanded) {
      const trigger = view.host.querySelector<HTMLButtonElement>(".su-permission-trigger");
      if (!trigger) throw new Error("Missing scope header");
      await click(trigger);
    }
    const lines = view.host.querySelector(".hm-permission-lines");
    if (!lines) throw new Error("Missing scoped lines");
    expect(lines?.textContent?.includes("This folder")).toBe(shape === "split");
    expect(lines?.textContent?.includes("Everything in it")).toBe(shape === "split");
    expect(lines?.textContent?.includes("Inherited from")).toBe(shape === "ancestor");
    if (shape === "split") {
      expect(
        [...lines.querySelectorAll("[role=switch]")].map((toggle) =>
          toggle.getAttribute("aria-label"),
        ),
      ).toEqual(["Files · This folder for Bob", "Files · Everything in it for Bob"]);
    }
    if (shape === "merged") {
      const toggle = lines.querySelector<HTMLButtonElement>("[role=switch]");
      if (!toggle) throw new Error("Missing merged toggle");
      await click(toggle);
      expect(state.revoke).toHaveBeenCalledWith(person.lines[0]);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      const merged = person.lines[0];
      if (!merged) throw new Error("Missing merged line");
      await view.render(
        h(PermissionAccessRow, {
          row: person,
          binding: {
            ...state,
            removed: { [merged.key]: { row: person, line: merged, token: "merged" } },
          },
          storage: "https://pod.test/",
          view: "overview",
          technical: false,
          alwaysExpanded: true,
        }),
      );
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
        "Bob will lose access to your Files",
      );
      const undo = [...view.host.querySelectorAll("button")].find(
        (button) => button.textContent === "Undo",
      );
      if (!undo) throw new Error("Missing merged Undo");
      await click(undo);
      expect(state.undo).toHaveBeenCalledWith("merged");
    }
    await view.unmount();
  }
});

it.each([
  "public",
  "authenticated",
] as const)("makes both pseudo agents private from the %s row's button and shortcut", async (kind) => {
  const state = binding();
  state.rows = (["public", "authenticated"] as const).map((kind) => ({
    ...row,
    key: kind,
    id: kind,
    kind,
    lines: row.lines.map((line) => ({ ...line, key: kind })),
  }));
  const pseudo = state.rows.find((item) => item.kind === kind) as AgentRow;
  const view = await mount(
    h(PermissionAccessRow, {
      row: pseudo,
      binding: state,
      storage: "https://pod.test/",
      view: "overview",
      technical: false,
      alwaysExpanded: true,
    }),
  );
  const trigger = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Make private",
  );
  if (!trigger) throw new Error("Missing Make private button");
  for (const shortcut of [false, true]) {
    if (shortcut) await key(trigger, "r");
    else await click(trigger);
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Make private?");
    expect(dialog?.textContent).toContain("Remove all public and signed-in access");
    const confirm = [...(dialog?.querySelectorAll("button") || [])].find(
      (button) => button.textContent === "Remove access",
    );
    if (!confirm) throw new Error("Missing Make private confirmation");
    await click(confirm);
    expect(state.revoke).toHaveBeenLastCalledWith("makePrivate");
  }
  expect(state.revoke).toHaveBeenCalledTimes(2);
});

it.each([
  ["button", "at once"],
  ["shortcut", "at once"],
  ["button", "later"],
  ["shortcut", "later"],
] as const)("moves focus to the row's header, not the disabled Revoke all, after confirming by %s (saving %s)", async (via, timing) => {
  const state = binding();
  function Saving() {
    const [busy, setBusy] = useState(false);
    const live: PermissionsBinding = {
      ...state,
      busy,
      // The save state can land with the click or only after the dialog has closed.
      revoke: vi.fn(async () => {
        if (timing === "at once") setBusy(true);
        else setTimeout(() => setBusy(true), 30);
      }),
    };
    return h(PermissionAccessRow, {
      row,
      binding: live,
      storage: "https://pod.test/",
      view: "overview",
      technical: false,
      alwaysExpanded: true,
    });
  }
  const view = await mount(h(Saving));
  const trigger = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Revoke all",
  ) as HTMLButtonElement;
  const header = view.host.querySelector<HTMLButtonElement>(".su-permission-trigger");
  trigger.focus();
  if (via === "button") await click(trigger);
  else await key(trigger, "r");
  const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (button) => button.textContent === "Remove access",
  ) as HTMLButtonElement;
  confirm.focus();
  await click(confirm);
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(trigger.disabled).toBe(true);
  expect(document.activeElement).toBe(header);
});

it("keeps keyboard focus on the switch while saving and returns it there after Undo", async () => {
  const state = binding();
  const props = {
    row,
    storage: "https://pod.test/",
    view: "overview" as const,
    technical: false,
    alwaysExpanded: true,
  };
  const view = await mount(h(PermissionAccessRow, { ...props, binding: state }));
  const toggle = () =>
    view.host.querySelector<HTMLButtonElement>(".hm-permission-line [role=switch]");
  toggle()?.focus();
  await click(toggle() as HTMLButtonElement);
  expect(state.revoke).toHaveBeenCalledTimes(1);
  const line = row.lines[0] as AgentRow["lines"][number];
  // Saving: the switch stays focusable (aria-disabled, not disabled) and ignores input.
  await view.render(
    h(PermissionAccessRow, {
      ...props,
      binding: { ...state, busy: true, removed: { files: { row, line } } },
    }),
  );
  expect(document.activeElement).toBe(toggle());
  expect(toggle()?.disabled).toBe(false);
  expect(toggle()?.getAttribute("aria-disabled")).toBe("true");
  // The focusable controls carry the explanation, so their wrappers add no tab stop.
  const stops = () =>
    [...view.host.querySelectorAll(".hm-permission-hint")].map((hint) =>
      hint.getAttribute("tabindex"),
    );
  expect(stops()).toEqual(["-1", "-1"]);
  const css = readFileSync(
    new URL("../src/apps/home/components/permissions/permissions.css", import.meta.url),
    "utf8",
  );
  expect(css).toMatch(/\.hm-permission-line \[aria-disabled="true"\] \{[^}]*opacity: 0\.5/);
  await click(toggle() as HTMLButtonElement);
  expect(state.revoke).toHaveBeenCalledTimes(1);
  const saved = { ...state, removed: { files: { row, line, token: "t" } } };
  await view.render(h(PermissionAccessRow, { ...props, binding: saved }));
  const undo = [...view.host.querySelectorAll(".hm-permission-line button")].find(
    (b) => b.textContent === "Undo",
  ) as HTMLButtonElement | undefined;
  if (!undo) throw new Error("Missing Undo");
  undo.focus();
  await click(undo);
  expect(state.undo).toHaveBeenCalledWith("t");
  expect(document.activeElement).toBe(toggle());
  // Restored: the consequence block unmounts without dropping focus to the page.
  await view.render(h(PermissionAccessRow, { ...props, binding: state }));
  expect(document.activeElement).toBe(toggle());
  expect(toggle()?.hasAttribute("aria-disabled")).toBe(false);
  // Offline the switch is truly disabled, so its wrapper is the keyboard path to why.
  await view.render(h(PermissionAccessRow, { ...props, binding: { ...state, online: false } }));
  expect(toggle()?.disabled).toBe(true);
  expect(stops()).toEqual(["0", "0"]);
});

it("explains and disables an Undo whose rules were changed elsewhere", async () => {
  const state = binding();
  const line = row.lines[0] as AgentRow["lines"][number];
  const view = await mount(
    h(PermissionAccessRow, {
      row,
      binding: { ...state, removed: { files: { row, line, token: "t", stale: true } } },
      storage: "https://pod.test/",
      view: "overview",
      technical: false,
      alwaysExpanded: true,
    }),
  );
  expect(view.host.querySelector(".hm-permission-line [role=status]")?.textContent).toContain(
    "This access was changed elsewhere, so it can't be restored here",
  );
  expect(
    [...view.host.querySelectorAll(".hm-permission-line button")].some(
      (b) => b.textContent === "Undo",
    ),
  ).toBe(false);
  const toggle = view.host.querySelector<HTMLButtonElement>(".hm-permission-line [role=switch]");
  await click(toggle as HTMLButtonElement);
  expect(state.undo).not.toHaveBeenCalled();
});

it("labels Files relative to a pod mounted below the origin root", async () => {
  const nested: AgentRow = {
    ...row,
    lines: row.lines.map((line) => ({
      ...line,
      dataType: undefined,
      resources: line.resources.map((r) => ({ ...r, url: "https://pod.test/alice/drive/Work/" })),
    })),
  };
  const view = await mount(
    h(PermissionAccessRow, {
      row: nested,
      binding: binding(),
      storage: "https://pod.test/alice/",
      view: "overview",
      technical: false,
      alwaysExpanded: true,
    }),
  );
  expect(
    view.host.querySelector(".hm-permission-line [role=switch]")?.getAttribute("aria-label"),
  ).toBe("Files for Bob");
});

it("puts Requests beside the tabs as a link and counts unchecked items once", async () => {
  const link = await mount(h(RequestsLink, { pending: 2 }));
  const anchor = link.host.querySelector("a");
  expect(anchor?.getAttribute("href")).toBe("/permissions/requests");
  expect(anchor?.textContent).toBe("Requests2 pending");
  expect(anchor?.closest("[role=tablist]")).toBeNull();
  const none = await mount(h(RequestsLink, {}));
  expect(none.host.textContent).toBe("Requests");
  const state = binding();
  state.failures = [
    { url: "https://pod.test/a", reason: "unreadable" },
    { url: "https://pod.test/a", reason: "forbidden" },
  ];
  const notices = await mount(h(PermissionNotices, { binding: state }));
  expect(notices.host.textContent).toBe("1 item couldn't be checked");
});

it("shows Client ID Document links safely and loads a remote logo only after consent", async () => {
  const view = await mount(
    h(ClientCard, {
      metadata: {
        name: "MaraCoach",
        uri: "https://maracoach.example/about",
        policyUri: "https://maracoach.example/privacy",
        tosUri: "https://maracoach.example/terms",
        logoUri: "https://images.example/mara.svg",
      },
    }),
  );
  const links = [...view.host.querySelectorAll("a")];
  expect(links.map((link) => link.textContent)).toEqual([
    "App website",
    "Privacy policy",
    "Terms of service",
  ]);
  expect(links.every((link) => link.rel === "noopener noreferrer")).toBe(true);
  expect(view.host.querySelector("img")).toBeNull();
  const show = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Show logo",
  );
  if (!show) throw new Error("Missing Show logo");
  await click(show);
  const logo = view.host.querySelector("img");
  expect(logo?.getAttribute("src")).toBe("https://images.example/mara.svg");
  expect(logo?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(logo?.getAttribute("alt")).toBe("MaraCoach logo");
  const empty = await mount(h(ClientCard, { metadata: {} }));
  expect(empty.host.textContent).toContain("This app hasn't provided any details.");
});

it("shows the seeded app's resolved name and loads its demo logo only after Show logo", async () => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
  const pod = createDemoPod({ root: DEMO_ROOT, seed: seedPermissionApp(0) });
  const fetch = vi.spyOn(pod, "fetch");
  const browser = await import("../src/lib/demo-pod/browser");
  const getPod = vi.spyOn(browser, "getDemoPod").mockResolvedValue(pod);
  try {
    const { resolveClientName } = await import("../src/apps/home/lib/permissions/client");
    const metadata = await resolveClientName(DEMO_APP_CLIENT_ID);
    expect(metadata.name).toBe("NoteNest");
    expect(metadata.logoUri).toBe(DEMO_APP_LOGO);
    const view = await mount(h(ClientCard, { metadata }));
    expect(view.host.textContent).toContain("NoteNest");
    expect(view.host.querySelector("img")).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([DEMO_APP_CLIENT_ID]);
    const show = [...view.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show logo",
    );
    if (!show) throw new Error("Missing demo Show logo");
    await click(show);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([DEMO_APP_CLIENT_ID, DEMO_APP_LOGO]);
    expect(view.host.querySelector("img")?.getAttribute("alt")).toBe("NoteNest logo");
    expect(view.host.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  } finally {
    getPod.mockRestore();
    vi.unstubAllEnvs();
  }
});
