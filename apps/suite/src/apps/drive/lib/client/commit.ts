// AUTHORED-BY Codex

export const unconfirmedIdentityMessage =
  "This item's version or access discovery could not be confirmed. Refresh and confirm again.";

export interface ResourceIdentity {
  readonly url: string;
  readonly etag: string;
  readonly verifyHeaders?: (headers: Headers) => undefined;
}

/** Final content checks must also assert the endpoint captured with that resource. */
export interface ResourceAssertion extends ResourceIdentity {
  readonly verifyHeaders: (headers: Headers) => undefined;
}

/** A supplemental proof cannot authorize disposal without its captured discovery. */
export function requireResourceAssertion<T extends ResourceIdentity>(
  identity: T,
  error: (status: number, url: string) => Error,
): T & ResourceAssertion {
  if (!identity.verifyHeaders) throw error(428, identity.url);
  return identity as T & ResourceAssertion;
}

/** Transport an existing capture without discovering or substituting a new one. */
export function discoveryOptions(captured: {
  readonly verifyHeaders?: ResourceIdentity["verifyHeaders"];
}): { readonly verifyHeaders?: ResourceAssertion["verifyHeaders"] } {
  return captured.verifyHeaders ? { verifyHeaders: captured.verifyHeaders } : {};
}

/** Carry the user's captured discovery together with their conditional validator. */
export function confirmationOptions(captured: {
  readonly etag?: string;
  readonly verifyHeaders?: ResourceAssertion["verifyHeaders"];
}):
  | { readonly ifMatch: string; readonly verifyHeaders?: ResourceAssertion["verifyHeaders"] }
  | undefined {
  return captured.etag === undefined
    ? undefined
    : {
        ifMatch: captured.etag,
        ...discoveryOptions(captured),
      };
}

export interface PolicyIdentity {
  readonly url: string;
  /** null pins the absence of an own ACL. */
  readonly etag: string | null;
  /** Discovery captured with this policy document, when present. */
  readonly verifyHeaders?: (headers: Headers) => undefined;
}

/** A later read verifies a captured identity; it never supplies its replacement. */
export function assertVersion(
  identity: ResourceIdentity,
  observed: string | null | undefined,
  error: (status: number, url: string) => Error,
): void {
  if (observed !== identity.etag) throw error(412, identity.url);
}

interface HttpIdentity extends PolicyIdentity {
  readonly allowMissing?: boolean;
  readonly http: typeof fetch;
  readonly error: (status: number, url: string) => Error;
  /** Synchronous assertion only; no hydration or I/O after the final HEAD. */
  readonly verifyHeaders?: (headers: Headers) => undefined;
}

export interface CommitChecks {
  /** Synchronous endpoint assertions on the final target HEAD, using captured data only. */
  readonly verifyHeaders?: HttpIdentity["verifyHeaders"];
  /** Hydrated policy receipts; checked after all persistence and callbacks. */
  readonly policyGuards?: readonly PolicyIdentity[];
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
      identity.verifyHeaders,
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
      /** Every existing target carries discovery captured before the final check. */
      readonly verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]>;
      readonly error: (status: number, url: string) => Error;
      readonly allowMissing?: boolean;
      readonly finalIdentities?: readonly (HttpIdentity & ResourceAssertion)[];
      /** ACL writes also bind their protected representation after checking the ACL. */
      readonly resourceGuards?: readonly ResourceAssertion[];
      readonly response: (response: Response) => Promise<T>;
    },
): Promise<T> {
  const headers = new Headers(options.init.headers);
  const etag = headers.get("if-match");
  if (!etag && headers.get("if-none-match") !== "*")
    return Promise.reject(options.error(428, options.url));
  const init = { ...options.init, headers };
  const policies = new Map<string, PolicyIdentity>();
  for (const identity of options.policyGuards ?? []) {
    const key = JSON.stringify([identity.url, identity.etag]);
    const previous = policies.get(key);
    // Deduplicate HTTP checks, never captured assertions. A supplemental guard
    // cannot erase discovery captured earlier for the same content validator.
    policies.set(
      key,
      previous
        ? {
            ...identity,
            ...(previous.verifyHeaders || identity.verifyHeaders
              ? {
                  verifyHeaders: (headers: Headers): undefined => {
                    previous.verifyHeaders?.(headers);
                    identity.verifyHeaders?.(headers);
                  },
                }
              : {}),
          }
        : identity,
    );
  }
  return commitIrreversible({
    ...options,
    finalIdentities: [
      ...[...policies.values()].map((identity) => ({
        ...identity,
        http: options.http,
        error: options.error,
      })),
      ...(options.finalIdentities ?? []),
      ...(etag
        ? [
            {
              http: options.http,
              url: options.url,
              etag,
              error: options.error,
              verifyHeaders: options.verifyHeaders,
              ...(options.allowMissing ? { allowMissing: true } : {}),
            },
          ]
        : []),
      ...(options.resourceGuards ?? []).map((identity) => ({
        ...identity,
        http: options.http,
        error: options.error,
      })),
    ],
    step: async () => options.response(await options.http(options.url, init)),
  });
}

/** Check both the precondition and the response, including servers ignoring If-Match. */
export async function checkIdentity(
  http: typeof fetch,
  url: string,
  etag: string | null,
  error: (status: number, url: string) => Error,
  allowMissing = false,
  verifyHeaders?: HttpIdentity["verifyHeaders"],
): Promise<void> {
  const response = await http(url, {
    method: "HEAD",
    cache: "no-store",
    headers: etag === null ? { "if-none-match": "*" } : { "if-match": etag },
  });
  if (etag === null) {
    if (response.status === 404 || response.status === 410) return;
    throw error(response.ok || response.status === 304 ? 412 : response.status, url);
  }
  if (allowMissing && (response.status === 404 || response.status === 410)) return;
  if (!response.ok) throw error(response.status, url);
  assertVersion({ url, etag }, response.headers.get("etag"), error);
  if (!verifyHeaders) throw error(428, url);
  verifyHeaders(response.headers);
}
