// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { type SharingGeneralAccess, sharingGrantPolicy } from "../src/sharing/grant-policy.js";
import type { SharingRole } from "../src/sharing/role-select.js";

const roles: SharingRole[] = ["viewer", "commenter", "editor", "manager"];
const currentRoles = [undefined, ...roles, "owner"] as const;
const modes = ["restricted", "link", "signed-in"] as const;
const generalRoles = [undefined, "viewer", "commenter", "editor"] as const;
const reason = "Related policies are unavailable";

describe("sharing grant restrictions", () => {
  it.each([
    undefined,
    {},
    { grantDisabledReason: "" },
    { updateWarning: "Unconfirmed" },
  ])("keeps all controls available without a grant restriction: %j", (state) => {
    const policy = sharingGrantPolicy(state);
    expect(policy.disabled).toBe(false);
    for (const current of currentRoles) {
      for (const next of [null, ...roles]) expect(policy.allowsPerson(current, next)).toBe(true);
      if (current) expect(policy.roleOptions(current)).toEqual({});
    }
    for (const current of modes)
      for (const next of modes)
        expect(policy.allowsGeneral({ mode: current }, { mode: next })).toBe(true);
  });

  it("permits every removal and equal or lower person role, and explains every blocked option", () => {
    const policy = sharingGrantPolicy({ grantDisabledReason: reason });
    expect(policy.disabled).toBe(true);
    for (const current of currentRoles) {
      expect(policy.allowsPerson(current, null)).toBe(true);
      for (const next of roles) {
        const allowed =
          current !== undefined && currentRoles.indexOf(next) <= currentRoles.indexOf(current);
        expect(policy.allowsPerson(current, next), `${current} -> ${next}`).toBe(allowed);
        if (current)
          expect(policy.roleOptions(current)[next]).toEqual(
            allowed ? undefined : { disabled: true, reason },
          );
      }
    }
  });

  it("permits restriction and same-audience downgrades across every general mode and role", () => {
    const policy = sharingGrantPolicy({ grantDisabledReason: reason });
    const rank = (role: SharingGeneralAccess["role"]) =>
      ["viewer", "commenter", "editor"].indexOf(role ?? "viewer");
    for (const mode of modes)
      for (const role of generalRoles)
        for (const nextMode of modes)
          for (const nextRole of generalRoles) {
            const current: SharingGeneralAccess = { mode, ...(role ? { role } : {}) };
            const next: SharingGeneralAccess = {
              mode: nextMode,
              ...(nextRole ? { role: nextRole } : {}),
            };
            expect(
              policy.allowsGeneral(current, next),
              `${mode}/${role} -> ${nextMode}/${nextRole}`,
            ).toBe(
              nextMode === "restricted" || (mode === nextMode && rank(nextRole) <= rank(role)),
            );
          }
  });

  it("uses the latest restriction when a delayed grant or Undo is invoked", () => {
    const ready = sharingGrantPolicy();
    expect(ready.allowsPerson(undefined, "viewer")).toBe(true);
    const restricted = sharingGrantPolicy({ grantDisabledReason: reason });
    expect(restricted.allowsPerson(undefined, "viewer")).toBe(false);
    expect(restricted.allowsGeneral({ mode: "restricted" }, { mode: "link" })).toBe(false);
    expect(sharingGrantPolicy().allowsPerson(undefined, "viewer")).toBe(true);
  });
});
