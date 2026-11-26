// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  capabilitiesForRole,
  podRoleFor,
  ROLE_PRESETS,
  ROLES,
  type Role,
  roleForPodRole,
  roleHasCapability,
} from "./roles";

describe("F7 role model — role → capability mapping", () => {
  it("exposes three presets coarse→fine", () => {
    expect(ROLES.map((r) => r.role)).toEqual(["viewer", "editor", "admin"]);
  });

  it("maps each role to its @jeswr/pod-access role", () => {
    expect(podRoleFor("viewer")).toBe("viewer");
    expect(podRoleFor("editor")).toBe("editor");
    expect(podRoleFor("admin")).toBe("manager");
    expect(ROLES.map((r) => r.podRole)).toEqual(["viewer", "editor", "manager"]);
  });

  it("maps each role to its app-level capabilities", () => {
    expect(capabilitiesForRole("viewer")).toEqual(["read"]);
    expect(capabilitiesForRole("editor")).toEqual(["read", "comment", "edit"]);
    expect(capabilitiesForRole("admin")).toEqual(["read", "comment", "edit", "share"]);
  });

  it("roleHasCapability matches the capability lists", () => {
    expect(roleHasCapability("viewer", "read")).toBe(true);
    expect(roleHasCapability("viewer", "edit")).toBe(false);
    expect(roleHasCapability("editor", "edit")).toBe(true);
    expect(roleHasCapability("editor", "share")).toBe(false);
    expect(roleHasCapability("admin", "share")).toBe(true);
  });

  it("capabilities escalate monotonically (every coarser role's caps ⊆ finer role's)", () => {
    const caps = (r: Role) => new Set(capabilitiesForRole(r));
    const viewer = caps("viewer");
    const editor = caps("editor");
    const admin = caps("admin");
    for (const c of viewer) expect(editor.has(c)).toBe(true);
    for (const c of editor) expect(admin.has(c)).toBe(true);
  });
});

describe("F7 roleForPodRole — the inverse of the role map", () => {
  it("round-trips for all three roles", () => {
    for (const { role } of ROLES) {
      expect(roleForPodRole(podRoleFor(role))).toBe(role);
    }
    expect(ROLE_PRESETS.admin.podRole).toBe("manager");
  });

  it("never PROMOTES: a pod-access commenter (no issue Write) is shown as a viewer", () => {
    expect(roleForPodRole("commenter")).toBe("viewer");
  });
});
