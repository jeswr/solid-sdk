// AUTHORED-BY Codex GPT-6.1-Sol

export type GeoErrorCode =
  | "INVALID_COORDINATE"
  | "INVALID_ZOOM"
  | "INVALID_POINTS"
  | "TOO_MANY_POINTS";

/** Static messages never disclose a photo's location or identifier. */
export class GeoError extends Error {
  constructor(public readonly code: GeoErrorCode) {
    super(`Photo geo: ${code}`);
    this.name = "GeoError";
  }
}

export function requireGeo(condition: unknown, code: GeoErrorCode): asserts condition {
  if (!condition) throw new GeoError(code);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
