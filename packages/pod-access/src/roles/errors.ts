// AUTHORED-BY Codex
import type { RoleError } from "./types.js";

const errors = new WeakSet<object>();
export function roleError(code: RoleError["code"], url: string, message: string): RoleError {
  const error = Object.assign(new Error(`${message}${url ? `: ${url}` : ""}`), {
    name: "RoleError",
    code,
    url,
    feature: "accessControl" as const,
  });
  errors.add(error);
  return error;
}
/** Identify this module's typed access-control errors (including unsupported features). */
export function isRoleError(error: unknown): error is RoleError {
  return typeof error === "object" && error !== null && errors.has(error);
}
