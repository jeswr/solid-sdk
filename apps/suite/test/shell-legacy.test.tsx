// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type { LegacyPlan } from "@jeswr/pod-legacy";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { folderName, grantPreview, legacyWarning } from "../src/shell/legacy/presentation";
import { LegacyEditor, LegacySettings, RecoveryChecklist } from "../src/shell/settings/legacy";
import { act, h } from "./drive-ui-dom";

const shell = vi.hoisted(() => ({
  active: null as null | Record<string, unknown>,
  legacy: { session: null, error: "", loading: false } as Record<string, unknown>,
}));
vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({ active: shell.active }),
}));
vi.mock("../src/shell/legacy/provider", () => ({ useLegacy: () => shell.legacy }));
vi.mock("@/apps/contacts/lib/model/book", () => {
  throw new Error("no address book in this test");
});
const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { render, fireEvent, screen, waitFor, cleanup } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
afterEach(cleanup);
const root = "https://alice.example/";
function plan(): LegacyPlan {
  return {
    owner: `${root}profile#me`,
    storage: root,
    contacts: [
      {
        webId: "https://alex.example/#me",
        displayName: "Alex",
        mode: "read",
        scope: "containers",
        targets: [`${root}Photos/`],
      },
    ],
    enabled: true,
    inactivityMonths: 6,
    warningDays: [30, 7],
    notifyMeBy: ["settings", "tray"],
    created: new Date("2025-01-01"),
    modified: new Date("2026-01-01"),
    lastActivity: new Date("2026-01-01"),
  };
}
it("explains recovery without profile writes and provides provider/export links", () => {
  const account = {
    id: "alice",
    webId: `${root}profile#me`,
    name: "Alice",
    storageUrl: root,
    issuer: "https://issuer.example/",
    kind: "solid" as const,
  };
  const html = renderToStaticMarkup(
    h(RecoveryChecklist, {
      account,
      issuers: ["https://issuer.example/", "https://backup.example/"],
      provider: "https://issuer.example/account/",
    }),
  );
  expect(html).toContain("lists 2 sign-in providers");
  expect(html).toContain("/settings/export");
  expect(html).toContain("no export history");
  expect(html).toContain("does not change your profile");
  expect(html).toContain('href="https://issuer.example/account/"');
  expect(
    renderToStaticMarkup(
      h(RecoveryChecklist, { account, issuers: null, provider: "javascript:bad" }),
    ),
  ).toContain("Could not check");
  expect(renderToStaticMarkup(h(RecoveryChecklist, { account, issuers: [] }))).toContain(
    "does not list a backup",
  );
});
it("formats advisory warnings, deadlines, folder names and disabled previews", () => {
  const p = plan();
  expect(legacyWarning(p, new Date("2026-06-01"))).toContain("5 months");
  expect(legacyWarning(p, new Date("2026-06-01"))).toContain("30 days");
  expect(legacyWarning(p, new Date("2026-07-01"))).toContain("Nothing has been shared");
  expect(legacyWarning(p, new Date("2026-02-01"))).toBeNull();
  p.enabled = false;
  expect(legacyWarning(p, new Date("2030-01-01"))).toBeNull();
  expect(grantPreview(p)).toEqual(["If this happens, Alex would be able to read Photos."]);
  p.contacts[0]!.scope = "whole-pod";
  expect(grantPreview(p)[0]).toContain("except settings (Photos)");
  p.contacts = [];
  expect(grantPreview(p)).toEqual([]);
  expect(folderName("https://example.org/")).toBe("Whole pod");
  expect(folderName("https://example.org/My%20files/")).toBe("My files");
  expect(folderName("https://example.org/%bad/")).toBe("%bad");
});
it("adds a read-only draft contact and saves selected folders with clear status", async () => {
  const save = vi.fn(async (_plan: LegacyPlan) => {});
  render(
    h(LegacyEditor, {
      initial: plan(),
      folders: [`${root}Photos/`, `${root}Documents/`],
      people: [{ name: "Jordan", webId: "https://jordan.example/#me" }],
      onSave: save,
    }),
  );
  fireEvent.change(screen.getByLabelText("Choose from contacts"), {
    target: { value: "https://jordan.example/#me" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Photos /Photos/" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Documents /Documents/" }));
  fireEvent.click(screen.getByRole("button", { name: "Add legacy contact" }));
  expect(screen.getByRole("region", { name: "Proposed access preview" }).textContent).toContain(
    "Jordan would be able to read Photos and Documents",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0]).toMatchObject({
    contacts: [
      expect.any(Object),
      {
        webId: "https://jordan.example/#me",
        mode: "read",
        targets: [`${root}Photos/`, `${root}Documents/`],
      },
    ],
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Legacy plan saved"),
  );
  cleanup();
});
it("keeps invalid drafts out of previews and exposes save failures", async () => {
  render(
    h(LegacyEditor, {
      initial: plan(),
      folders: [],
      people: [],
      onSave: async () => {
        throw new Error("Make settings private");
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add legacy contact" }));
  expect(screen.getByRole("status").textContent).toContain("valid HTTPS WebID");
  fireEvent.change(screen.getByLabelText("Another folder IRI"), {
    target: { value: "javascript:bad" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Include folder IRI" }));
  expect(screen.getByRole("status").textContent).toContain("inside your pod");
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Make settings private"),
  );
  cleanup();
});
it.each([
  `${root}settings/`,
  `${root}settings/private/`,
  `${root}%73ettings/`,
  `${root}settings/legacy-plan.ttl`,
  root,
])("rejects the private folder target %s in the editor", (target) => {
  render(h(LegacyEditor, { initial: plan(), folders: [], people: [], onSave: vi.fn() }));
  fireEvent.change(screen.getByLabelText("Another folder IRI"), { target: { value: target } });
  fireEvent.click(screen.getByRole("button", { name: "Include folder IRI" }));
  expect(screen.getByRole("status").textContent).toContain(
    "Settings and its contents are excluded",
  );
});
it("whole-pod preview lists top-level folders and excludes settings, nested folders and the root", async () => {
  const save = vi.fn(async (_plan: LegacyPlan) => {});
  render(
    h(LegacyEditor, {
      initial: { ...plan(), contacts: [] },
      folders: [
        `${root}Photos/`,
        `${root}Photos/Trips/`,
        `${root}Documents/`,
        `${root}settings/`,
        `${root}settings/private/`,
      ],
      people: [],
      onSave: save,
    }),
  );
  fireEvent.change(screen.getByLabelText("Legacy contact WebID"), {
    target: { value: "https://alex.example/#me" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alex" } });
  fireEvent.change(screen.getByLabelText("Access scope"), { target: { value: "whole-pod" } });
  fireEvent.click(screen.getByRole("button", { name: "Add legacy contact" }));
  expect(screen.getByRole("region", { name: "Proposed access preview" }).textContent).toContain(
    "except settings (Photos and Documents)",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0].contacts[0]?.targets).toEqual([
    `${root}Photos/`,
    `${root}Documents/`,
  ]);
});
it("saves a disabled plan without contacts and offers conditional withdrawal", async () => {
  const save = vi.fn(async (_plan: LegacyPlan) => {});
  const remove = vi.fn(async () => {});
  render(
    h(LegacyEditor, { initial: plan(), folders: [], people: [], onSave: save, onDelete: remove }),
  );
  fireEvent.click(screen.getByLabelText("Enable legacy plan evaluation"));
  fireEvent.click(screen.getByRole("button", { name: "Remove Alex" }));
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0]).toMatchObject({ enabled: false, contacts: [] });
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("saved"));
  fireEvent.click(screen.getByRole("button", { name: "Delete my legacy plan" }));
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("deleted"));
});
it("keeps the plan editable after a delete conflict", async () => {
  render(
    h(LegacyEditor, {
      initial: plan(),
      folders: [],
      people: [],
      onSave: vi.fn(),
      onDelete: async () => {
        throw new Error("The plan changed. Reload before deleting.");
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete my legacy plan" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Reload before deleting"),
  );
  expect(
    (screen.getByRole("button", { name: "Save legacy plan" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
const account = {
  id: "alice",
  webId: `${root}profile#me`,
  name: "Alice",
  storageUrl: root,
  kind: "solid" as const,
};
function session(overrides: Record<string, unknown> = {}) {
  return {
    account,
    storage: {
      // biome-ignore lint/correctness/useYield: an unreadable listing in this test.
      async *listAll() {
        throw new Error("no listing");
      },
    },
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
    snapshot: { plan: plan(), etag: '"one"' },
    revision: 0,
    notice: "",
    now: () => new Date("2026-06-01T12:00:00Z"),
    save: vi.fn(async (_plan: LegacyPlan, _base: unknown) => {}),
    delete: vi.fn(async (_base: unknown) => {}),
    ...overrides,
  };
}
function settings(value: Record<string, unknown>) {
  shell.active = account;
  shell.legacy = { session: null, error: "", loading: false, ...value };
  return h(LegacySettings);
}
it("remounts the editor with a notice when another tab changed the plan, dropping the stale draft", async () => {
  const first = session();
  const view = render(settings({ session: first }));
  const enabled = () =>
    (screen.getByLabelText("Enable legacy plan evaluation") as HTMLInputElement).checked;
  fireEvent.click(screen.getByLabelText("Enable legacy plan evaluation"));
  expect(enabled()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(first.save).toHaveBeenCalledOnce());
  // The save carries the snapshot the draft was edited from.
  expect(first.save.mock.calls[0]).toEqual([
    expect.objectContaining({ enabled: false }),
    first.snapshot,
  ]);
  // A heartbeat-only update keeps the draft (same revision).
  fireEvent.click(screen.getByLabelText("Enable legacy plan evaluation"));
  view.rerender(settings({ session: { ...first, snapshot: { ...first.snapshot, etag: '"hb"' } } }));
  expect(enabled()).toBe(true);
  // Another tab's content change bumps the revision: the latest version replaces the draft.
  const winner = { ...plan(), enabled: false, contacts: [] };
  const second = session({
    snapshot: { plan: winner, etag: '"two"' },
    revision: 1,
    notice: "Your legacy plan was changed in another tab or device.",
  });
  view.rerender(settings({ session: second }));
  expect(enabled()).toBe(false);
  expect(screen.queryByRole("button", { name: "Remove Alex" })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("changed in another tab or device");
  fireEvent.click(screen.getByRole("button", { name: "Delete my legacy plan" }));
  await waitFor(() => expect(second.delete).toHaveBeenCalledExactlyOnceWith(second.snapshot));
});
it("offers replacement or deletion of an unreadable saved plan", async () => {
  const current = session({ snapshot: { plan: null, etag: '"broken"', invalid: true } });
  render(settings({ session: current }));
  expect(screen.getByText(/could not be read, so nothing is evaluated or shared/)).toBeTruthy();
  // The editor starts from a fresh disabled plan dated by the session clock.
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(current.save).toHaveBeenCalledOnce());
  expect(current.save.mock.calls[0]).toEqual([
    expect.objectContaining({
      enabled: false,
      contacts: [],
      created: new Date("2026-06-01T12:00:00Z"),
    }),
    current.snapshot,
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Delete my legacy plan" }));
  await waitFor(() => expect(current.delete).toHaveBeenCalledOnce());
});
it("starts a new plan from the device clock when the session clock is invalid", async () => {
  const current = session({ snapshot: null, now: () => new Date(Number.NaN) });
  render(settings({ session: current }));
  fireEvent.change(screen.getByLabelText("Legacy contact WebID"), {
    target: { value: "https://alex.example/#me" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Alex" } });
  fireEvent.change(screen.getByLabelText("Another folder IRI"), {
    target: { value: `${root}Photos/` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Include folder IRI" }));
  fireEvent.click(screen.getByRole("button", { name: "Add legacy contact" }));
  expect(screen.getByRole("status").textContent).toContain("Contact added");
  expect(screen.queryByRole("button", { name: "Delete my legacy plan" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(current.save).toHaveBeenCalledOnce());
  const saved = current.save.mock.calls[0]![0];
  for (const time of [saved.created, saved.modified, saved.lastActivity])
    expect(Number.isFinite(time.getTime())).toBe(true);
  expect(current.save.mock.calls[0]?.[1]).toBeNull();
});
it("offers deletion when privacy cannot be verified and reports its failure", async () => {
  const withdraw = vi.fn(async (): Promise<void> => {
    throw new Error("The plan changed. Reload before deleting.");
  });
  render(settings({ error: "Make settings private", withdraw }));
  expect(screen.getByRole("alert").textContent).toContain("Make settings private");
  expect(screen.queryByRole("button", { name: "Save legacy plan" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete my legacy plan" }));
  });
  expect(withdraw).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Delete the unverified legacy plan" }).textContent,
    ).toContain("Reload before deleting"),
  );
  withdraw.mockResolvedValueOnce(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete my legacy plan" }));
  });
  expect(withdraw).toHaveBeenCalledTimes(2);
});
it("never saves modified earlier than created when the device clock is slow", async () => {
  const save = vi.fn(async (_plan: LegacyPlan) => {});
  const p = plan();
  p.created = new Date("2026-03-01T12:00:00Z");
  p.modified = p.created;
  p.lastActivity = p.created;
  render(
    h(LegacyEditor, {
      initial: p,
      folders: [],
      people: [],
      onSave: save,
      now: () => new Date("2026-01-01T00:00:00Z"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0].modified).toEqual(p.created);
  cleanup();
  render(
    h(LegacyEditor, {
      initial: p,
      folders: [],
      people: [],
      onSave: save,
      now: () => new Date("2026-04-01T00:00:00Z"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save legacy plan" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[0].modified).toEqual(new Date("2026-04-01T00:00:00Z"));
});
