// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type { LegacyPlan } from "@jeswr/pod-legacy";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { folderName, grantPreview, legacyWarning } from "../src/shell/legacy/presentation";
import { LegacyEditor, RecoveryChecklist } from "../src/shell/settings/legacy";
import { h } from "./drive-ui-dom";

vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({ active: null }),
}));
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
