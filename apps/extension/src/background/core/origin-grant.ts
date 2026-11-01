// AUTHORED-BY GPT-6.1-Sol (Codex)
/** Explicit origin → profile authority. Class grants only have meaning beneath this record. */
import { type ClassGrant, sanitiseGrants } from './class-grant';

export interface OriginGrant {
  readonly origin: string;
  readonly profileId: string;
  readonly scope: { readonly pods: readonly string[]; readonly classes?: readonly ClassGrant[] };
  readonly createdAt: number;
  readonly expiresAt?: number;
}

export function canonicalOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value
      ? u.origin
      : null;
  } catch {
    return null;
  }
}

/** Corrupt/ambiguous records never confer authority; duplicate origin bindings deny both. */
export function sanitiseOriginGrants(raw: unknown): OriginGrant[] {
  if (!Array.isArray(raw)) return [];
  const valid: OriginGrant[] = [];
  const counts = new Map<string, number>();
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const g = value as OriginGrant;
    if (
      !canonicalOrigin(g.origin) ||
      typeof g.profileId !== 'string' ||
      !g.profileId ||
      !Number.isFinite(g.createdAt) ||
      (g.expiresAt !== undefined && !Number.isFinite(g.expiresAt)) ||
      !g.scope ||
      !Array.isArray(g.scope.pods) ||
      !g.scope.pods.every((p) => canonicalOrigin(p) !== null) ||
      (g.scope.classes !== undefined && !Array.isArray(g.scope.classes))
    )
      continue;
    counts.set(g.origin, (counts.get(g.origin) ?? 0) + 1);
    valid.push({
      origin: g.origin,
      profileId: g.profileId,
      createdAt: g.createdAt,
      ...(g.expiresAt === undefined ? {} : { expiresAt: g.expiresAt }),
      scope: {
        pods: [...g.scope.pods],
        ...(g.scope.classes === undefined
          ? {}
          : {
              classes: sanitiseGrants(g.scope.classes).filter((c) => c.origin === g.origin),
            }),
      },
    });
  }
  return valid.filter((g) => counts.get(g.origin) === 1);
}

export function liveOriginGrant(grants: readonly OriginGrant[], origin: string, now: number) {
  return (
    grants.find((g) => g.origin === origin && (g.expiresAt === undefined || g.expiresAt > now)) ??
    null
  );
}

export interface OriginGrantPersistence {
  read(): Promise<unknown>;
  write(grants: readonly OriginGrant[]): Promise<void>;
}

export class OriginGrantStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly persistence: OriginGrantPersistence) {}
  async list(): Promise<OriginGrant[]> {
    await this.tail;
    return sanitiseOriginGrants(await this.persistence.read());
  }
  /** One writer makes replacing a profile binding atomic, including concurrent consent. */
  update(change: (grants: OriginGrant[]) => readonly OriginGrant[]): Promise<void> {
    const run = this.tail.then(async () => {
      const current = sanitiseOriginGrants(await this.persistence.read());
      await this.persistence.write(sanitiseOriginGrants(change(current)));
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
