// AUTHORED-BY Codex GPT-6.1-Sol

export type UploadPlanningErrorCode =
  | "invalid-input"
  | "invalid-name"
  | "invalid-path"
  | "invalid-target"
  | "invalid-size"
  | "invalid-chunk-size"
  | "plan-too-large"
  | "invalid-listing"
  | "ambiguous-drop"
  | "kind-conflict"
  | "missing-etag";

/** Codes only: error messages never echo private names, URLs or ETags. */
export class UploadPlanningError extends Error {
  constructor(public readonly code: UploadPlanningErrorCode) {
    super(`Upload planning: ${code}`);
    this.name = "UploadPlanningError";
  }
}

export function requireValue(condition: unknown, code: UploadPlanningErrorCode): asserts condition {
  if (!condition) throw new UploadPlanningError(code);
}

export function record(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "invalid-input",
  );
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, "invalid-input");
  requireValue(
    Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key)),
    "invalid-input",
  );
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => descriptor.enumerable && "value" in descriptor,
    ),
    "invalid-input",
  );
}

export function kind(value: unknown): asserts value is "file" | "folder" {
  requireValue(value === "file" || value === "folder", "invalid-input");
}

export function byteSize(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) >= 0, "invalid-size");
}

export function chunkSize(value: unknown): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) > 0, "invalid-chunk-size");
}

export function segment(value: unknown): asserts value is string {
  requireValue(
    typeof value === "string" &&
      value.length > 0 &&
      value.isWellFormed() &&
      value.trim() !== "." &&
      value.trim() !== "..",
    "invalid-path",
  );
}

export function path(value: unknown): asserts value is readonly string[] {
  requireValue(Array.isArray(value) && value.length > 0, "invalid-path");
  for (const part of value) segment(part);
}

export function hasControls(value: string): boolean {
  return [...value].some((char) => char <= "\u001f" || (char >= "\u007f" && char <= "\u009f"));
}

export function targetContainer(value: unknown): asserts value is string {
  requireValue(typeof value === "string", "invalid-target");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UploadPlanningError("invalid-target");
  }
  requireValue(
    (url.protocol === "https:" || url.protocol === "http:") &&
      url.href === value &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      value.endsWith("/"),
    "invalid-target",
  );
  if (url.pathname === "/") return;
  for (const part of url.pathname.slice(1, -1).split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new UploadPlanningError("invalid-target");
    }
    requireValue(
      decoded.length > 0 &&
        !decoded.includes("/") &&
        !decoded.includes("\\") &&
        !hasControls(decoded) &&
        encodeURIComponent(decoded) === part,
      "invalid-target",
    );
  }
}
