// AUTHORED-BY Codex

export interface CommitChecks {
  readonly rechecks?: readonly (() => Promise<void>)[];
  readonly identityChecks?: readonly (() => Promise<void>)[];
}

/** An undo is live only while the version it protects remains recoverable. */
export class Compensation {
  private armed = false;

  constructor(private readonly undo: () => Promise<void>) {}

  arm(): void {
    this.armed = true;
  }

  disarm(): void {
    this.armed = false;
  }

  async rollback(): Promise<void> {
    if (!this.armed) return;
    this.disarm();
    await this.undo();
  }
}

export interface CommitEffects {
  readonly arm?: readonly Compensation[];
  readonly disarm?: readonly Compensation[];
  /** Synchronous bookkeeping, before any subsequent I/O can fail. */
  readonly onCommit?: () => void;
}

/** No access discovery, cleanup or persistence may intervene after the identity checks.
 * The step resolves only once its mutation is confirmed; ambiguous deletes keep their undo.
 */
export async function commitIrreversible<T>(
  options: CommitChecks & CommitEffects & { readonly step: () => Promise<T> },
): Promise<T> {
  for (const recheck of options.rechecks ?? []) await recheck();
  for (const check of options.identityChecks ?? []) await check();
  const result = await options.step();
  for (const compensation of options.disarm ?? []) compensation.disarm();
  for (const compensation of options.arm ?? []) compensation.arm();
  options.onCommit?.();
  return result;
}

/** Check both the precondition and the response, including servers ignoring If-Match. */
export async function checkIdentity(
  http: typeof fetch,
  url: string,
  etag: string,
  error: (status: number, url: string) => Error,
  allowMissing = false,
): Promise<void> {
  const response = await http(url, {
    method: "HEAD",
    cache: "no-store",
    headers: { "if-match": etag },
  });
  if (allowMissing && (response.status === 404 || response.status === 410)) return;
  if (!response.ok) throw error(response.status, url);
  if (response.headers.get("etag") !== etag) throw error(412, url);
}
