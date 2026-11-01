// AUTHORED-BY Codex GPT-6.1-Sol

export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export const MAX_LISTENS = 1_000_000;

export type ScrobbleErrorCode = "INVALID_EXPORT" | "EXPORT_TOO_LARGE";

export class ScrobbleError extends Error {
  readonly code: ScrobbleErrorCode;

  constructor(code: ScrobbleErrorCode) {
    super(`Scrobbles: ${code}`);
    this.name = "ScrobbleError";
    this.code = code;
  }
}

export type ListenSource = "listenbrainz" | "lastfm";

export interface Listen {
  readonly playedAt: string;
  readonly artist: string;
  readonly track: string;
  readonly album?: string;
  readonly durationMs?: number;
  readonly mbids: {
    readonly recording?: string;
    readonly release?: string;
    readonly artists?: readonly string[];
  };
  readonly source: ListenSource;
}

export interface ScrobbleWarning {
  readonly source: ListenSource;
  /** One-based physical line on which the record starts. */
  readonly line: number;
  readonly code: "INVALID_LISTEN" | "INVALID_MBID";
  readonly message: string;
  readonly field?: string;
}

export interface ScrobbleResult {
  readonly listens: readonly Listen[];
  readonly warnings: readonly ScrobbleWarning[];
}

export interface ScrobbleExports {
  readonly listenBrainz?: string;
  readonly lastFm?: string;
}

export interface ScrobbleImportOptions {
  /** Required injected clock; the library never reads the system clock. */
  readonly now: Date;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
