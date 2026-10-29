// AUTHORED-BY Codex

export interface ResourceIdentity {
  readonly url: string;
  readonly etag: string;
}

interface HttpIdentity extends ResourceIdentity {
  readonly allowMissing?: boolean;
  readonly http: typeof fetch;
  readonly error: (status: number, url: string) => Error;
}

export interface CommitChecks {
  readonly rechecks?: readonly (() => Promise<void>)[];
  /** Content proofs and hydration, before the helper's raw final HEAD checks. */
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
  options: CommitChecks &
    CommitEffects & {
      readonly step: () => Promise<T>;
      /** Data only: the helper owns the final HTTP checks, with no hydration callbacks. */
      readonly finalIdentities?: readonly HttpIdentity[];
    },
): Promise<T> {
  for (const recheck of options.rechecks ?? []) await recheck();
  for (const check of options.identityChecks ?? []) await check();
  for (const identity of options.finalIdentities ?? [])
    await checkIdentity(
      identity.http,
      identity.url,
      identity.etag,
      identity.error,
      identity.allowMissing,
    );
  const result = await options.step();
  for (const compensation of options.disarm ?? []) compensation.disarm();
  for (const compensation of options.arm ?? []) compensation.arm();
  options.onCommit?.();
  return result;
}

/** The request is fully hydrated before this helper owns the final HTTP checks.
 * Callers can process the response, but cannot insert work before sending it.
 * Its If-Match also supplies the final target check, so the two cannot diverge.
 */
export function commitHttp<T>(
  options: CommitChecks &
    CommitEffects & {
      readonly http: typeof fetch;
      readonly url: string;
      readonly init: RequestInit;
      readonly error: (status: number, url: string) => Error;
      readonly allowMissing?: boolean;
      readonly finalIdentities?: readonly HttpIdentity[];
      readonly response: (response: Response) => Promise<T>;
    },
): Promise<T> {
  const headers = new Headers(options.init.headers);
  const etag = headers.get("if-match");
  const init = { ...options.init, headers };
  return commitIrreversible({
    ...options,
    finalIdentities: [
      ...(options.finalIdentities ?? []),
      ...(etag
        ? [
            {
              http: options.http,
              url: options.url,
              etag,
              error: options.error,
              ...(options.allowMissing ? { allowMissing: true } : {}),
            },
          ]
        : []),
    ],
    step: async () => options.response(await options.http(options.url, init)),
  });
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
