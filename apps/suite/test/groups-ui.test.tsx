// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { readGrants, removeGrant } from "@jeswr/pod-access/roles";
import { GROUPS_UNVERIFIED, type GroupDirectory, type UnverifiedFolder } from "@jeswr/suite-groups";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { groupDirectory } from "../src/shell/groups/client";
import { GroupSharing } from "../src/shell/groups/group-sharing";
import { GroupsSettings } from "../src/shell/groups/groups-settings";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";

vi.mock("../src/shell/groups/client", () => ({ groupDirectory: vi.fn() }));
vi.mock("../src/shell/groups/family-spaces", () => ({ familySpaces: () => [] }));
vi.mock("../src/apps/contacts/lib/model/discovery", () => ({
  discoverContacts: async () => {
    throw new Error("Unavailable");
  },
}));
vi.mock("@jeswr/pod-access/roles", () => ({ readGrants: vi.fn(), removeGrant: vi.fn() }));
afterEach(cleanup);
const root = "https://pod.example/";
const session = { webId: `${root}profile#me`, storageUrl: root, fetch: vi.fn() };
const account = { id: "demo", name: "Alice", webId: session.webId, storageUrl: root, kind: "demo" };
const context = {
  active: account,
  fetch: session.fetch,
  isActiveAccount: () => true,
} as unknown as AccountsContextValue;
function setup() {
  vi.mocked(readGrants).mockClear();
  const groups = [
    {
      id: `${root}groups/family.ttl#this`,
      name: "Family",
      members: ["https://bob.example/#me"],
      family: true,
    },
  ];
  const directory = {
    list: vi.fn(async () => [...groups]),
    create: vi.fn(async (name: string, members: string[]) => {
      const group = { id: `${root}groups/new.ttl#this`, name, members, family: false };
      groups.push(group);
      return group;
    }),
    grants: vi.fn(async (group: string) => ({ group, resources: [`${root}drive/notes.md`] })),
    delete: vi.fn(async () => {
      groups.pop();
    }),
    share: vi.fn(async () => []),
    setupFamily: vi.fn(async () => []),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    rename: vi.fn(),
    unverified: vi.fn(async (): Promise<UnverifiedFolder[]> => []),
    verifyFolder: vi.fn(async () => {}),
  };
  vi.mocked(groupDirectory).mockResolvedValue(directory as unknown as GroupDirectory);
  vi.mocked(readGrants).mockResolvedValue({
    url: `${root}drive/notes.md`,
    grants: [],
    version: "test" as never,
  });
  return directory;
}
it("creates a group and shows a grants warning before deletion", async () => {
  const directory = setup();
  render(
    <AccountsContext.Provider value={context}>
      <GroupsSettings />
    </AccountsContext.Provider>,
  );
  const create = await screen.findByRole("region", { name: "Create group" });
  await waitFor(() =>
    expect(
      (within(create).getByLabelText("Group name", { exact: true }) as HTMLInputElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(within(create).getByLabelText("Group name", { exact: true }), {
    target: { value: "Book club" },
  });
  fireEvent.click(within(create).getByRole("button", { name: "Create group" }));
  const group = await screen.findByRole("region", { name: "Book club" });
  fireEvent.click(within(group).getByRole("button", { name: "Delete Book club" }));
  const review = await screen.findByRole("region", { name: "Delete group review" });
  expect(within(review).getByText(`${root}drive/notes.md`)).toBeTruthy();
  expect(directory.delete).not.toHaveBeenCalled();
  fireEvent.click(within(review).getByRole("button", { name: "Remove grants and delete group" }));
  await waitFor(() => expect(directory.delete).toHaveBeenCalledTimes(1));
});
const groupFolder = (overrides: Partial<UnverifiedFolder> = {}): UnverifiedFolder => ({
  folder: "groups",
  documents: [`${root}groups/a.ttl`, `${root}groups/b.ttl`],
  contents: [
    {
      url: `${root}groups/a.ttl`,
      inherits: true,
      kind: "group",
      name: "Family",
      members: ["https://bob.example/#me", "https://carol.example/#me"],
    },
    { url: `${root}groups/b.ttl`, inherits: true, kind: "group", name: "Team", members: [] },
  ],
  planted: false,
  keepable: true,
  ...overrides,
});
const settingsFolder = (overrides: Partial<UnverifiedFolder> = {}): UnverifiedFolder => ({
  folder: "settings",
  documents: [`${root}settings/group-sharing/state.json`],
  contents: [
    {
      url: `${root}settings/group-sharing/state.json`,
      inherits: true,
      kind: "settings",
      family: `${root}groups/family.ttl#this`,
      spaces: [`${root}private/`],
    },
  ],
  planted: false,
  keepable: true,
  ...overrides,
});
function renderSettings() {
  render(
    <AccountsContext.Provider value={context}>
      <GroupsSettings />
    </AccountsContext.Provider>,
  );
}
it("shows each changed group and its members, and keeps them only after a confirmation", async () => {
  const directory = setup();
  directory.unverified.mockResolvedValueOnce([groupFolder()]);
  directory.list.mockRejectedValueOnce(new Error(GROUPS_UNVERIFIED));
  renderSettings();
  const notice = await screen.findByRole("region", { name: "Group files changed" });
  expect(
    within(notice).getByText(
      "2 group files were changed outside the suite. Review them, then keep or remove them.",
    ),
  ).toBeTruthy();
  expect(within(notice).getByText("Family")).toBeTruthy();
  const members = within(notice).getByRole("list", { name: "Members of Family" });
  expect(
    within(members)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["https://bob.example/#me", "https://carol.example/#me"]);
  expect(within(notice).getByText("No members")).toBeTruthy();
  expect(within(notice).getByText(/anyone who could change this folder before/)).toBeTruthy();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", GROUPS_UNVERIFIED);
  // Nothing else can be changed until the owner decides.
  const create = screen.getByRole("region", { name: "Create group" });
  expect((create.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  // Remove comes first; Keep needs a confirmation, which takes focus.
  const buttons = within(notice).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual(["Remove", "Keep"]);
  const keep = within(notice).getByRole("button", { name: "Keep" });
  fireEvent.click(keep);
  const confirm = within(notice).getByRole("group", {
    name: "Keep these 2 groups and their members as they are?",
  });
  expect(document.activeElement).toBe(confirm);
  expect(within(confirm).getByText("Groups you keep: Family, Team.")).toBeTruthy();
  expect(directory.verifyFolder).not.toHaveBeenCalled();
  // Cancel returns focus to the button that opened the confirmation.
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(within(notice).getByRole("button", { name: "Keep" }));
  fireEvent.click(within(notice).getByRole("button", { name: "Keep" }));
  fireEvent.click(within(notice).getByRole("button", { name: "Keep files" }));
  await waitFor(() => expect(directory.verifyFolder).toHaveBeenCalledWith("groups", "keep"));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Group files changed" })).toBeNull(),
  );
  // Focus moves to the announced outcome.
  const status = await screen.findByText("Group files kept.");
  expect(status.getAttribute("role")).toBe("status");
  await waitFor(() => expect(document.activeElement).toBe(status));
  expect(await screen.findByRole("region", { name: "Family" })).toBeTruthy();
  expect((create.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
});
it("warns that removing groups ends their shares, and shows the settings' Family spaces", async () => {
  const directory = setup();
  directory.unverified.mockResolvedValueOnce([
    groupFolder({
      documents: [`${root}groups/a.ttl`],
      contents: groupFolder().contents.slice(0, 1),
    }),
    settingsFolder(),
  ]);
  renderSettings();
  const notice = await screen.findByRole("region", { name: "Group files changed" });
  expect(
    within(notice).getByText(
      "1 group file was changed outside the suite. Review them, then keep or remove them.",
    ),
  ).toBeTruthy();
  const settings = screen.getByRole("region", { name: "Group settings changed" });
  expect(
    within(settings).getByText(
      "Your group sharing settings were changed outside the suite. Review them, then keep or remove them.",
    ),
  ).toBeTruthy();
  // The Family group is named from the listed groups; its spaces are listed.
  expect(within(settings).getByText("Family group: Family")).toBeTruthy();
  expect(
    within(within(settings).getByRole("list", { name: "Family spaces" })).getByText(
      `${root}private/`,
    ),
  ).toBeTruthy();
  expect(
    within(settings).getByText(/Kept settings can give your Family group access/),
  ).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "Keep" }));
  expect(
    within(settings).getByText(`Your Family group can be given access to: ${root}private/.`),
  ).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "Cancel" }));
  const remove = within(notice).getByRole("button", { name: "Remove" });
  fireEvent.click(remove);
  const removal =
    "Remove these group files from your pod? Every share made through these groups ends. This can't be undone.";
  const confirm = within(notice).getByRole("group", { name: removal });
  expect(document.activeElement).toBe(confirm);
  expect(directory.verifyFolder).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(within(notice).queryByRole("group", { name: removal })).toBeNull();
  expect(document.activeElement).toBe(within(notice).getByRole("button", { name: "Remove" }));
  fireEvent.click(within(notice).getByRole("button", { name: "Remove" }));
  fireEvent.click(
    within(within(notice).getByRole("group", { name: removal })).getByRole("button", {
      name: "Remove files",
    }),
  );
  await waitFor(() => expect(directory.verifyFolder).toHaveBeenCalledWith("groups", "discard"));
  expect(directory.verifyFolder).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Group files removed."));
});
it("offers only removal for planted or unkeepable files, and focuses a failure", async () => {
  const directory = setup();
  directory.unverified.mockResolvedValueOnce([
    groupFolder({
      documents: [`${root}groups/a.ttl`, `${root}groups/b.ttl`, `${root}groups/c.ttl`],
      contents: [
        { url: `${root}groups/a.ttl`, inherits: true, kind: "unreadable" },
        { url: `${root}groups/b.ttl`, inherits: false, kind: "group", name: "", members: [] },
      ],
      keepable: false,
    }),
    settingsFolder({
      contents: [
        {
          url: `${root}settings/group-sharing/state.json`,
          inherits: true,
          kind: "settings",
          family: `${root}groups/unknown.ttl#this`,
          spaces: [],
        },
      ],
      planted: true,
      keepable: false,
    }),
  ]);
  directory.verifyFolder.mockRejectedValueOnce(new Error("Storage unavailable"));
  renderSettings();
  const notice = await screen.findByRole("region", { name: "Group files changed" });
  expect(within(notice).getByText("This file can't be read, so it can't be kept.")).toBeTruthy();
  expect(within(notice).getByText("Unnamed group")).toBeTruthy();
  expect(
    within(notice).getByText("This file has its own access settings, so it can't be kept."),
  ).toBeTruthy();
  expect(within(notice).getByText("1 more file isn't shown, so it can't be kept.")).toBeTruthy();
  expect(
    within(notice).getByText("Some of these files can't be kept. Remove them to continue."),
  ).toBeTruthy();
  expect(within(notice).queryByRole("button", { name: "Keep" })).toBeNull();
  const settings = screen.getByRole("region", { name: "Group settings changed" });
  expect(within(settings).getByText(`Family group: ${root}groups/unknown.ttl#this`)).toBeTruthy();
  expect(within(settings).getByText("No Family spaces")).toBeTruthy();
  expect(within(settings).getByText(/added by someone else while this folder/)).toBeTruthy();
  expect(within(settings).queryByRole("button", { name: "Keep" })).toBeNull();
  fireEvent.click(within(settings).getByRole("button", { name: "Remove" }));
  expect(
    within(settings).getByRole("group", {
      name: "Remove these group settings from your pod? This can't be undone.",
    }),
  ).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "Remove files" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Storage unavailable");
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(screen.queryByText("Group settings removed.")).toBeNull();
});
it("keeps settings that list no spaces, and has no Family group", async () => {
  const directory = setup();
  directory.unverified.mockResolvedValueOnce([
    settingsFolder({
      contents: [
        {
          url: `${root}settings/group-sharing/state.json`,
          inherits: true,
          kind: "settings",
          family: null,
          spaces: [],
        },
      ],
    }),
  ]);
  renderSettings();
  const settings = await screen.findByRole("region", { name: "Group settings changed" });
  expect(within(settings).getByText("Family group: none")).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "Keep" }));
  expect(within(settings).getByRole("group", { name: "Keep these group settings as they are?" }));
  expect(within(settings).getByText("These settings list no Family spaces.")).toBeTruthy();
  fireEvent.click(within(settings).getByRole("button", { name: "Keep files" }));
  await waitFor(() => expect(directory.verifyFolder).toHaveBeenCalledWith("settings", "keep"));
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Group settings kept."));
});
it("words keeping a single group", async () => {
  const directory = setup();
  directory.unverified.mockResolvedValueOnce([
    groupFolder({
      documents: [`${root}groups/a.ttl`],
      contents: groupFolder().contents.slice(0, 1),
    }),
  ]);
  renderSettings();
  const notice = await screen.findByRole("region", { name: "Group files changed" });
  fireEvent.click(within(notice).getByRole("button", { name: "Keep" }));
  expect(
    within(notice).getByRole("group", {
      name: "Keep this group and its members as they are?",
    }),
  ).toBeTruthy();
  expect(directory.verifyFolder).not.toHaveBeenCalled();
});
it("shows why ACP group sharing is unavailable", async () => {
  setup();
  vi.mocked(groupDirectory).mockRejectedValueOnce(
    new Error("Group sharing is available on WAC pods only. ACP is unsupported."),
  );
  render(<GroupSharing session={session} url={`${root}drive/file.txt`} />);
  expect(await screen.findByText(/Group sharing is available on WAC pods only/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Share with group" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("lists group names and member counts in the recipient picker", async () => {
  setup();
  render(<GroupSharing session={session} url={`${root}drive/file.txt`} />);
  const input = screen.getByRole("combobox", { name: "Add groups" });
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Family" } });
  expect(await screen.findByRole("option", { name: /Family · 1 members/ })).toBeTruthy();
});

it("shares a multi-resource item through one library operation", async () => {
  const directory = setup();
  const targets = [`${root}tracker.ttl`, `${root}tasks/`];
  render(<GroupSharing session={session} url={targets[0] as string} targets={targets} />);
  const input = screen.getByRole("combobox", { name: "Add groups" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Family" } });
  fireEvent.click(await screen.findByRole("option", { name: /Family · 1 members/ }));
  fireEvent.click(screen.getByRole("button", { name: "Share with group" }));
  await waitFor(() =>
    expect(directory.share).toHaveBeenCalledExactlyOnceWith(
      `${root}groups/family.ttl#this`,
      targets,
      "viewer",
    ),
  );
});

it("edits membership, renames groups and resumes Family setup", async () => {
  const directory = setup();
  render(
    <AccountsContext.Provider value={context}>
      <GroupsSettings />
    </AccountsContext.Provider>,
  );
  const family = await screen.findByRole("region", { name: "Family" });
  expect(screen.getByText(/member WebIDs are publicly readable/)).toBeTruthy();
  fireEvent.change(within(family).getByLabelText("Group name for Family"), {
    target: { value: "Our family" },
  });
  fireEvent.click(within(family).getByRole("button", { name: "Rename" }));
  await waitFor(() =>
    expect(directory.rename).toHaveBeenCalledWith(`${root}groups/family.ttl#this`, "Our family"),
  );
  await waitFor(() =>
    expect(
      (within(family).getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    within(family).getByRole("button", { name: "Remove https://bob.example/#me from Family" }),
  );
  await waitFor(() =>
    expect(directory.removeMember).toHaveBeenCalledWith(
      `${root}groups/family.ttl#this`,
      "https://bob.example/#me",
    ),
  );
  const input = within(family).getByRole("combobox", { name: "Add people" });
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(input, { target: { value: "https://carol.example/#me" } });
  fireEvent.click(within(family).getByRole("button", { name: "Add person" }));
  fireEvent.click(within(family).getByRole("button", { name: "Add members to Family" }));
  await waitFor(() =>
    expect(directory.addMember).toHaveBeenCalledWith(
      `${root}groups/family.ttl#this`,
      "https://carol.example/#me",
    ),
  );
  const setupButton = within(family).getByRole("button", {
    name: "Finish Family setup / invite new members",
  });
  await waitFor(() => expect((setupButton as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(setupButton);
  await waitFor(() =>
    expect(directory.setupFamily).toHaveBeenCalledWith(`${root}groups/family.ttl#this`, []),
  );
});

it("refreshes group grants after a failed sharing write and reports the partial outcome", async () => {
  const directory = setup();
  directory.share.mockRejectedValueOnce(new Error("Denied"));
  const onSaved = vi.fn();
  render(<GroupSharing session={session} url={`${root}drive/file.txt`} onSaved={onSaved} />);
  const input = screen.getByRole("combobox", { name: "Add groups" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Family" } });
  fireEvent.click(await screen.findByRole("option", { name: /Family · 1 members/ }));
  fireEvent.click(screen.getByRole("button", { name: "Share with group" }));
  expect(await screen.findByText(/Review Permissions before retrying/)).toBeTruthy();
  await waitFor(() => expect(readGrants).toHaveBeenCalledTimes(2));
  expect(onSaved).not.toHaveBeenCalled();
});

it("removes group access data-first and keeps listing a group any target still holds", async () => {
  setup();
  const tracker = `${root}tracker.ttl`;
  const folder = `${root}tasks/`;
  const family = `${root}groups/family.ttl#this`;
  const held = new Set([folder]);
  vi.mocked(readGrants).mockImplementation(async (url) => ({
    url,
    version: "test" as never,
    grants: held.has(url)
      ? [{ agent: { type: "group", id: family }, role: "editor", inherited: false, source: url }]
      : [],
  }));
  const order: string[] = [];
  vi.mocked(removeGrant).mockReset();
  vi.mocked(removeGrant).mockImplementation(async ([url]) => {
    order.push(url as string);
    // The data folder removal fails: the grant stays on it.
    return {
      applied: [],
      failed: url === folder ? [{ url, error: new Error("Denied") }] : [],
      notification: { requested: false, delivered: false },
    };
  });
  // Only the data folder holds the grant (an earlier partial removal); it is still listed.
  render(<GroupSharing session={session} url={tracker} targets={[tracker, folder]} />);
  const remove = await screen.findByRole("button", { name: "Remove group access" });
  expect(screen.getByText(/Family · editor/)).toBeTruthy();
  await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(remove);
  expect(await screen.findByText(/Review Permissions before retrying/)).toBeTruthy();
  // Data first; the failure stops before the item itself, so the item keeps listing the group.
  expect(order).toEqual([folder]);
  await waitFor(() => expect(readGrants).toHaveBeenCalledWith(folder, expect.anything()));
  expect(await screen.findByRole("button", { name: "Remove group access" })).toBeTruthy();
  // Once every removal succeeds, the group disappears.
  vi.mocked(removeGrant).mockImplementation(async ([url]) => {
    order.push(url as string);
    held.delete(url as string);
    return {
      applied: [url as string],
      failed: [],
      notification: { requested: false, delivered: false },
    };
  });
  const again = await screen.findByRole("button", { name: "Remove group access" });
  await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(again);
  await waitFor(() => expect(order).toEqual([folder, folder, tracker]));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Remove group access" })).toBeNull(),
  );
});
