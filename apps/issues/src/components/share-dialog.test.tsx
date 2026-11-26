// AUTHORED-BY Claude Sonnet 5.5
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const sharing = vi.hoisted(() => ({
  listRoleAssignments: vi.fn(),
  assignRole: vi.fn(),
  revokeAccess: vi.fn(),
  revokeCopiedAccess: vi.fn(),
  lowerCopiedAccess: vi.fn(),
}));
vi.mock("@/lib/sharing", () => sharing);
vi.mock("@/components/person", () => ({
  PersonAvatar: () => null,
  PersonName: ({ webId }: { webId: string }) => <span>{webId}</span>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { ShareDialog } from "@/components/share-dialog";

const OWNER = "https://pod.example/alice/profile/card#me";
const BOB = "https://pod.example/bob/profile/card#me";
const TRACKER = "https://pod.example/alice/issues/";
const CONFIG = "https://pod.example/alice/issues/config.ttl";
const ISSUE = "https://pod.example/alice/issues/1.ttl";

afterEach(() => {
  cleanup();
  calls.length = 0;
  for (const fn of Object.values(sharing)) fn.mockReset();
  vi.mocked(toast.error).mockReset();
});

function setup(role: "editor" | "admin" = "editor") {
  sharing.listRoleAssignments.mockResolvedValue([{ subject: BOB, kind: "agent", role }]);
  sharing.revokeCopiedAccess.mockImplementation(async () => void calls.push("copies"));
  sharing.revokeAccess.mockImplementation(async (url: string) => void calls.push(`revoke:${url}`));
  sharing.lowerCopiedAccess.mockImplementation(async () => void calls.push("lower-copies"));
  sharing.assignRole.mockImplementation(async (url: string) => void calls.push(`assign:${url}`));
  render(
    <ShareDialog
      open
      onOpenChange={() => {}}
      resourceUrl={TRACKER}
      extraResourceUrls={[CONFIG]}
      memberUrls={[ISSUE]}
      ownerWebId={OWNER}
    />,
  );
}

describe("ShareDialog", () => {
  it("revokes the copies first and the tracker last", async () => {
    setup();
    const button = await screen.findByRole("button", { name: /remove/i });
    fireEvent.click(button);
    await waitFor(() => expect(calls).toContain(`revoke:${TRACKER}`));
    expect(calls).toEqual(["copies", `revoke:${CONFIG}`, `revoke:${TRACKER}`]);
  });

  it("keeps the tracker grant and refreshes when copy revocation fails part-way", async () => {
    setup();
    sharing.revokeCopiedAccess.mockRejectedValue(new Error("Access was only partly removed"));
    fireEvent.click(await screen.findByRole("button", { name: /remove/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Access was only partly removed"));
    expect(sharing.revokeAccess).not.toHaveBeenCalled();
    await waitFor(() => expect(sharing.listRoleAssignments).toHaveBeenCalledTimes(2));
  });

  it("lowers the copies before the tracker when the role is lowered", async () => {
    setup("admin");
    await screen.findByText(BOB);
    fireEvent.change(screen.getByPlaceholderText(/webid|https/i), { target: { value: BOB } });
    fireEvent.click(screen.getByRole("button", { name: /^(share|grant|add)/i }));
    await waitFor(() => expect(calls).toContain(`assign:${CONFIG}`));
    expect(calls[0]).toBe("lower-copies");
    expect(sharing.lowerCopiedAccess).toHaveBeenCalledWith([ISSUE], OWNER, BOB, "editor");
  });

  it("refreshes the list when the config grant fails after the tracker grant", async () => {
    setup();
    sharing.assignRole.mockImplementation(async (url: string) => {
      if (url === CONFIG) throw new Error("config failed");
    });
    await screen.findByText(BOB);
    fireEvent.change(screen.getByPlaceholderText(/webid|https/i), { target: { value: BOB } });
    fireEvent.click(screen.getByRole("button", { name: /^(share|grant|add)/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(sharing.listRoleAssignments).toHaveBeenCalledTimes(2));
  });
});
