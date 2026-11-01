// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  generalAccessOptions,
  grantExpires,
  shareRoleOptions,
  shareSubtitle,
} from "../src/shell/lib/share-options";
import type { ShareCapabilities, SharingState } from "../src/shell/share/types";

const caps: ShareCapabilities = {
  publicLinks: true,
  authenticatedAgentGrants: true,
  grantExpiry: true,
  grantPurpose: true,
  notifyAgents: true,
  accessRequests: true,
  managerRole: true,
};
const state: SharingState = {
  people: [{ webId: "https://example.org/owner", role: "owner" }],
  general: { mode: "restricted" },
  canManage: true,
};
describe("sharing presentation", () => {
  it("counts only other people, with singular and plural copy", () => {
    expect(shareSubtitle(state)).toBe("Only you");
    expect(shareSubtitle({ ...state, people: [] })).toBe("Only you");
    expect(
      shareSubtitle({
        ...state,
        people: [...state.people, { webId: "https://example.org/another-owner", role: "owner" }],
      }),
    ).toBe("Shared with 1 person");
    expect(
      shareSubtitle({
        ...state,
        people: [{ webId: "https://example.org/friend", role: "viewer" }],
      }),
    ).toBe("Shared with 1 person");
    const people = [
      ...state.people,
      { webId: "https://example.org/friend", role: "viewer" as const },
    ];
    expect(shareSubtitle({ ...state, people })).toBe("Shared with 1 person");
    expect(
      shareSubtitle({
        ...state,
        people: [...people, { webId: "https://example.org/other", role: "viewer" }],
      }),
    ).toBe("Shared with 2 people");
    for (const [role, verb] of [
      ["viewer", "view"],
      ["commenter", "comment"],
      ["editor", "edit"],
    ] as const)
      expect(shareSubtitle({ ...state, general: { mode: "link", role } })).toBe(
        `Anyone with the link can ${verb}`,
      );
    expect(shareSubtitle({ ...state, general: { mode: "link" } })).toBe(
      "Anyone with the link can view",
    );
    expect(shareSubtitle({ ...state, general: { mode: "signed-in" } })).toBe(
      "Anyone signed in has access",
    );
  });
  it("gates role options by kind, management and adapter support", () => {
    expect(shareRoleOptions("document", caps, true)).toEqual([
      "viewer",
      "commenter",
      "editor",
      "manager",
    ]);
    for (const kind of ["file", "folder", "chatroom"] as const)
      expect(shareRoleOptions(kind, caps, false)).toEqual(["viewer", "editor"]);
    expect(shareRoleOptions("document", caps, true, false)).toEqual([
      "viewer",
      "editor",
      "manager",
    ]);
    expect(shareRoleOptions("document", { ...caps, managerRole: false }, true)).toEqual([
      "viewer",
      "commenter",
      "editor",
    ]);
  });
  it("keeps general choices visible for every capability combination", () => {
    for (const publicLinks of [true, false])
      for (const authenticatedAgentGrants of [true, false])
        expect(
          generalAccessOptions({ ...caps, publicLinks, authenticatedAgentGrants }).map(
            (option) => option.disabled,
          ),
        ).toEqual([false, !publicLinks, !authenticatedAgentGrants]);
  });
  it("computes duration and rejects invalid/past custom dates", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(grantExpires("until-revoked", "", now)).toBeUndefined();
    expect(grantExpires("day", "", now)?.getDate()).toBe(2);
    expect(grantExpires("month", "", now)?.getMonth()).toBe(11);
    expect(grantExpires("year", "", now)?.getFullYear()).toBe(2027);
    expect(grantExpires("custom", "2027-01-04", now)?.getDate()).toBe(4);
    expect(() => grantExpires("custom", "", now)).toThrow("future");
    expect(() => grantExpires("custom", "2020-01-01", now)).toThrow("future");
  });
});
