// AUTHORED-BY Codex GPT-6.1-Sol
export interface ChangeBase {
  readonly id: string;
  /** Stable identity supplied by the caller; survives a URL-changing move. */
  readonly fileId: string;
  readonly url: string;
  readonly kind: "resource" | "container";
  readonly actor: string;
  /** Integer Unix milliseconds, from 1970 through 9999 (no implicit date parsing). */
  readonly at: number;
}

export type ChangeEvent = ChangeBase &
  (
    | { readonly type: "created" | "updated" | "deleted" | "shared"; readonly fromUrl?: never }
    | { readonly type: "moved"; readonly fromUrl: string }
  );

export interface FileActivity {
  readonly fileId: string;
  readonly url: string;
  readonly kind: "resource" | "container";
  readonly deleted: boolean;
  readonly lastActivityAt: number;
  /** Oldest first; retains each event's original URL and actor. */
  readonly events: readonly ChangeEvent[];
}

export interface DayGroup<T> {
  readonly date: string;
  readonly items: readonly T[];
}
