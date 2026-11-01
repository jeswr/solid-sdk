// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import type { ResourceKind, Role } from "./index.js";
import { isRoleError, modesToRole, rolesToModes } from "./index.js";

const kinds: ResourceKind[] = ["resource", "folder", "document", "chatroom"];
const roles: Role[] = ["viewer", "commenter", "editor", "manager"];
describe("role modes", () => {
  it("round trips every role and kind on both models", () => {
    for (const model of ["wac", "acp"] as const)
      for (const implementation of ["css", "ess"] as const)
        for (const kind of kinds)
          for (const role of roles) {
            const ctx = {
              model,
              implementation,
              commentsContainer: "https://pod.example/comments/",
            };
            expect(modesToRole(rolesToModes(role, kind, ctx), kind, ctx)).toBe(role);
          }
  });
  it("maps ACP management to the trusted implementation's enforcement target", () => {
    expect(rolesToModes("manager", "resource", { model: "acp" })).toEqual({
      resource: ["read", "write", "append", "control"],
      comments: [],
      acr: [],
    });
    expect(rolesToModes("manager", "resource", { model: "acp", implementation: "ess" })).toEqual({
      resource: ["read", "write", "append"],
      comments: [],
      acr: ["read", "write"],
    });
  });
  it("requires document comments and never rounds up partial or odd modes", () => {
    expect(() => rolesToModes("commenter", "document", {})).toThrow("commentsContainer");
    expect(modesToRole(["read", "append"], "resource")).toBeUndefined();
    expect(modesToRole(["read", "control"], "resource")).toBeUndefined();
    expect(modesToRole(["control"], "resource")).toBeUndefined();
    expect(modesToRole(["write"], "folder")).toBeUndefined();
    expect(modesToRole(["read"], "document")).toBe("viewer");
    expect(modesToRole(["read", "write"], "resource")).toBe("editor");
    expect(modesToRole(["read", "write"], "chatroom")).toBe("editor");
    try {
      rolesToModes("commenter", "document", {});
    } catch (error) {
      expect(isRoleError(error)).toBe(true);
      expect(error).toMatchObject({ code: "comments-container-required" });
    }
    expect(isRoleError(null)).toBe(false);
    expect(isRoleError({ code: "conflict" })).toBe(false);
  });
});
