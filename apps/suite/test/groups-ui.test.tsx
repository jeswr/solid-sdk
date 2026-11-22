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
it("asks the owner to keep or remove group files changed outside the suite", async () => {
  const directory = setup();
  const documents = [`${root}groups/a.ttl`, `${root}groups/b.ttl`];
  directory.unverified.mockResolvedValueOnce([{ folder: "groups", documents }]);
  directory.list.mockRejectedValueOnce(new Error(GROUPS_UNVERIFIED));
  render(
    <AccountsContext.Provider value={context}>
      <GroupsSettings />
    </AccountsContext.Provider>,
  );
  const notice = await screen.findByRole("region", { name: "Group files changed" });
  expect(
    within(notice).getByText(
      "2 group files were changed outside the suite. Keep them or remove them?",
    ),
  ).toBeTruthy();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", GROUPS_UNVERIFIED);
  // Nothing else can be changed until the owner decides.
  const create = screen.getByRole("region", { name: "Create group" });
  expect((create.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  fireEvent.click(within(notice).getByRole("button", { name: "Keep" }));
  await waitFor(() => expect(directory.verifyFolder).toHaveBeenCalledWith("groups", "keep"));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Group files changed" })).toBeNull(),
  );
  expect(await screen.findByRole("region", { name: "Family" })).toBeTruthy();
  expect((create.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
});
it("confirms before removing changed files, and words a single file or settings", async () => {
  const directory = setup();
  directory.unverified.mockResolvedValueOnce([
    { folder: "groups", documents: [`${root}groups/a.ttl`] },
    { folder: "settings", documents: [`${root}settings/group-sharing/state.json`] },
  ]);
  render(
    <AccountsContext.Provider value={context}>
      <GroupsSettings />
    </AccountsContext.Provider>,
  );
  const notice = await screen.findByRole("region", { name: "Group files changed" });
  expect(
    within(notice).getByText(
      "1 group file was changed outside the suite. Keep them or remove them?",
    ),
  ).toBeTruthy();
  const settings = screen.getByRole("region", { name: "Group settings changed" });
  expect(
    within(settings).getByText(
      "Your group sharing settings were changed outside the suite. Keep them or remove them?",
    ),
  ).toBeTruthy();
  fireEvent.click(within(notice).getByRole("button", { name: "Remove" }));
  const confirm = within(notice).getByRole("group", {
    name: "Remove them from your pod? This can't be undone.",
  });
  expect(directory.verifyFolder).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(
    within(notice).queryByRole("group", {
      name: "Remove them from your pod? This can't be undone.",
    }),
  ).toBeNull();
  fireEvent.click(within(notice).getByRole("button", { name: "Remove" }));
  fireEvent.click(
    within(
      within(notice).getByRole("group", {
        name: "Remove them from your pod? This can't be undone.",
      }),
    ).getByRole("button", {
      name: "Remove files",
    }),
  );
  await waitFor(() => expect(directory.verifyFolder).toHaveBeenCalledWith("groups", "discard"));
  expect(directory.verifyFolder).toHaveBeenCalledTimes(1);
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
