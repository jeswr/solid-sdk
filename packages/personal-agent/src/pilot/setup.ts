/**
 * Local provisioning: keys, owner-signed mandate and representation statement, public
 * introduction cards, and the reviewed step that pins a peer's card.
 *
 * Private keys are generated at runtime into directories the caller chooses (the CLI
 * default `.awp-runtime/` is git-ignored) with mode 0600. They are synthetic test keys
 * with no production claim.
 *
 * Owner custody. The SERVICE directory (`<root>/<name>/`) holds what the running agent needs:
 * the actor key, identity, owner-signed mandate/representation, trust and card. Opening an
 * agent (`readAgent`) never reads owner private material. The OWNER key signs mandates and
 * approvals and is read only by explicit owner-signing commands (`readOwnerKey`):
 *  - separate custody (`saveAgent(..., { ownerDir })`, CLI `init --owner-dir DIR`): the owner
 *    key is written to `DIR/<name>/owner.private.jwk.json` and never into the service dir;
 *  - colocated (compatibility for directories created before phase 7, or `init` without
 *    `--owner-dir`): the owner key sits at `keys/owner.private.jwk.json` in the service dir.
 * Separate directories for the same OS user are a filesystem boundary only — not hardware
 * custody or OS-level isolation. No location is discovered: the operator names it each time.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { JWK } from "jose";
import { scopedUrn } from "./core/canonical.js";
import type { Iri } from "./core/types.js";
import {
  generateSigningKey,
  type KeyAlg,
  loadSigningKey,
  type SigningKey,
} from "./mechanisms/jws.js";
import { type OwnerMandate, signMandate } from "./mechanisms/mandate.js";
import { type RepresentationStatement, signStatement, TYP } from "./mechanisms/statements.js";
import type { PinnedKey, SourceAuthorityRule, TrustStoreData } from "./mechanisms/trust.js";

export interface IntroductionCard {
  readonly type: "AwpIntroductionCard";
  readonly party: Iri;
  readonly actor: Iri;
  readonly operator?: Iri;
  readonly partyKey: { readonly kid: string; readonly alg: KeyAlg; readonly publicJwk: JWK };
  readonly actorKey: { readonly kid: string; readonly alg: KeyAlg; readonly publicJwk: JWK };
  readonly endpoints: readonly string[];
  readonly notice: string;
}

export interface Identity {
  readonly name: string;
  readonly party: Iri;
  readonly actor: Iri;
  readonly operator?: Iri;
  readonly email?: string;
}

export interface ProvisionedAgent {
  readonly identity: Identity;
  readonly ownerKey: SigningKey;
  readonly actorKey: SigningKey;
  readonly mandateJws: string;
  readonly representationJws: string;
  readonly trust: TrustStoreData;
  readonly card: IntroductionCard;
  readonly privateJwks?: { readonly owner: JWK; readonly actor: JWK };
}

export const CARD_NOTICE =
  "Public verification material only. Compare both thumbprints with the owner out of band " +
  "before pinning. Pinning a card establishes key attribution, not authority.";

export async function provisionAgent(input: {
  identity: Identity;
  alg?: KeyAlg;
  now: Date;
  mandate: (ids: { owner: Iri; actor: Iri; validFrom: string; validUntil: string }) => OwnerMandate;
  representationOperations: readonly Iri[];
  validityDays?: number;
  /**
   * An EXISTING owner (organisation) key to sign this agent's mandate and representation —
   * several actors of one organisation, each with its own actor key and mandate. Its private
   * part is not returned (it already lives in the owner directory).
   */
  existingOwnerKey?: SigningKey;
}): Promise<ProvisionedAgent> {
  const alg = input.alg ?? "EdDSA";
  const owner = input.existingOwnerKey
    ? { key: input.existingOwnerKey, privateJwk: undefined }
    : await generateSigningKey(alg);
  const actor = await generateSigningKey(alg);
  return assemble({
    ...input,
    alg,
    ownerKey: owner.key,
    actorKey: actor.key,
    privateJwks: { owner: owner.privateJwk as JWK, actor: actor.privateJwk },
  });
}

async function assemble(input: {
  identity: Identity;
  alg: KeyAlg;
  now: Date;
  mandate: (ids: { owner: Iri; actor: Iri; validFrom: string; validUntil: string }) => OwnerMandate;
  representationOperations: readonly Iri[];
  validityDays?: number;
  ownerKey: SigningKey;
  actorKey: SigningKey;
  privateJwks?: { owner: JWK; actor: JWK };
}): Promise<ProvisionedAgent> {
  const { identity } = input;
  const validFrom = new Date(input.now.getTime() - 60_000).toISOString();
  const validUntil = new Date(
    input.now.getTime() + (input.validityDays ?? 30) * 86_400_000,
  ).toISOString();
  const mandate = input.mandate({
    owner: identity.party,
    actor: identity.actor,
    validFrom,
    validUntil,
  });
  const mandateJws = await signMandate(input.ownerKey, mandate);
  const rep: RepresentationStatement = {
    type: "RepresentationStatement",
    id: scopedUrn("representation", identity.actor, String(input.now.getTime())),
    party: identity.party,
    actor: identity.actor,
    actorKid: input.actorKey.kid,
    ...(identity.operator ? { operator: identity.operator } : {}),
    operations: [...input.representationOperations],
    validFrom,
    validUntil,
    issuedAt: input.now.toISOString(),
  };
  const representationJws = await signStatement(input.ownerKey, TYP.representation, rep);
  const ownerPin: PinnedKey = {
    role: "party",
    subject: identity.party,
    kid: input.ownerKey.kid,
    alg: input.ownerKey.alg,
    publicJwk: input.ownerKey.publicJwk,
    note: "local owner (pinned at provisioning)",
  };
  const card: IntroductionCard = {
    type: "AwpIntroductionCard",
    party: identity.party,
    actor: identity.actor,
    ...(identity.operator ? { operator: identity.operator } : {}),
    partyKey: {
      kid: input.ownerKey.kid,
      alg: input.ownerKey.alg,
      publicJwk: input.ownerKey.publicJwk,
    },
    actorKey: {
      kid: input.actorKey.kid,
      alg: input.actorKey.alg,
      publicJwk: input.actorKey.publicJwk,
    },
    endpoints: identity.email ? [`mailto:${identity.email}`] : [],
    notice: CARD_NOTICE,
  };
  return {
    identity,
    ownerKey: input.ownerKey,
    actorKey: input.actorKey,
    mandateJws,
    representationJws,
    trust: { version: 1, owner: identity.party, keys: [ownerPin], sourceAuthority: [] },
    card,
    ...(input.privateJwks ? { privateJwks: input.privateJwks } : {}),
  };
}

/** Re-sign a new mandate/representation for an existing identity (e.g. to test expiry). */
export async function reissue(
  agent: ProvisionedAgent,
  input: {
    now: Date;
    mandate: (ids: {
      owner: Iri;
      actor: Iri;
      validFrom: string;
      validUntil: string;
    }) => OwnerMandate;
    representationOperations: readonly Iri[];
    validityDays?: number;
  },
): Promise<ProvisionedAgent> {
  const next = await assemble({
    ...input,
    identity: agent.identity,
    alg: agent.actorKey.alg,
    ownerKey: agent.ownerKey,
    actorKey: agent.actorKey,
  });
  return { ...next, trust: agent.trust };
}

/**
 * Pin a peer's introduction card. This is the reviewed, local step that makes a peer's
 * keys verifiable; `expectedThumbprints` (when given) must match what the owner compared.
 */
export function introduce(
  trust: TrustStoreData,
  card: IntroductionCard,
  expectedThumbprints?: { party: string; actor: string },
): TrustStoreData {
  if (card.type !== "AwpIntroductionCard") throw new Error("not an introduction card");
  if (
    expectedThumbprints &&
    (expectedThumbprints.party !== card.partyKey.kid ||
      expectedThumbprints.actor !== card.actorKey.kid)
  ) {
    throw new Error("thumbprints do not match the out-of-band comparison");
  }
  const keys = trust.keys.filter((k) => k.kid !== card.partyKey.kid && k.kid !== card.actorKey.kid);
  const partyPinned = keys.some((k) => k.role === "party" && k.subject === card.party);
  return {
    ...trust,
    keys: [
      ...keys,
      ...(partyPinned
        ? []
        : [
            {
              role: "party" as const,
              subject: card.party,
              ...card.partyKey,
              note: "pinned by introduction",
            },
          ]),
      {
        role: "actor" as const,
        subject: card.actor,
        party: card.party,
        ...card.actorKey,
        endpoints: [...card.endpoints],
        note: "pinned by introduction",
      },
    ],
  };
}

/** Pin an evidence issuer (payroll company, programme authority, ...). */
export function pinIssuer(
  trust: TrustStoreData,
  issuer: Iri,
  key: SigningKey,
  note?: string,
): TrustStoreData {
  return {
    ...trust,
    keys: [
      ...trust.keys.filter((k) => k.kid !== key.kid),
      {
        role: "issuer",
        subject: issuer,
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        ...(note ? { note } : {}),
      },
    ],
  };
}

export function addSourceRule(trust: TrustStoreData, rule: SourceAuthorityRule): TrustStoreData {
  return {
    ...trust,
    sourceAuthority: [...trust.sourceAuthority.filter((r) => r.id !== rule.id), rule],
  };
}

// ------------------------------------------------------------------ on-disk layout

function writePrivate(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function agentDir(root: string, name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name))
    throw new Error("agent name must be [a-z0-9-], max 41 chars");
  return join(root, name);
}

export const COLOCATED_OWNER_KEY = "keys/owner.private.jwk.json";
export const OWNER_KEY_FILE = "owner.private.jwk.json";

/** Where an owner directory keeps one agent's owner key. */
export function ownerKeyPath(ownerDir: string, name: string): string {
  return join(ownerDir, basename(agentDir("", name)), OWNER_KEY_FILE);
}

/**
 * Write a provisioned agent to `<root>/<name>/` (private keys 0600). With `ownerDir` the owner
 * key goes to `ownerDir/<name>/` only (separate custody); without it, it is colocated in the
 * service directory (compatibility).
 */
export function saveAgent(
  root: string,
  agent: ProvisionedAgent,
  accepted: readonly string[],
  options: {
    ownerDir?: string;
    /** Owner-key name in the owner directory (default: the agent name; an org may share one). */
    ownerName?: string;
    /** The owner key already exists there (shared organisation key): do not write it. */
    reuseOwnerKey?: boolean;
  } = {},
): string {
  const dir = agentDir(root, agent.identity.name);
  if (!agent.privateJwks) throw new Error("private key material unavailable to save");
  const ownerRecord = { alg: agent.ownerKey.alg, jwk: agent.privateJwks.owner };
  if (options.ownerDir) {
    const path = ownerKeyPath(resolve(options.ownerDir), options.ownerName ?? agent.identity.name);
    const keyDir = dirname(path);
    const service = resolve(dir);
    const within = (a: string, b: string) => a === b || a.startsWith(`${b}${sep}`);
    if (within(keyDir, service) || within(service, keyDir))
      throw new Error("the owner directory must be outside the agent's service directory");
    mkdirSync(join(dir, "keys"), { recursive: true, mode: 0o700 });
    if (!options.reuseOwnerKey) {
      if (existsSync(path))
        throw new Error(`an owner key already exists at ${path}; not overwritten`);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writePrivate(path, ownerRecord);
    }
  } else if (options.reuseOwnerKey) {
    throw new Error("a shared owner key needs separate custody (--owner-dir)");
  } else {
    mkdirSync(join(dir, "keys"), { recursive: true, mode: 0o700 });
    writePrivate(join(dir, COLOCATED_OWNER_KEY), ownerRecord);
  }
  writePrivate(join(dir, "keys", "actor.private.jwk.json"), {
    alg: agent.actorKey.alg,
    jwk: agent.privateJwks.actor,
  });
  writeFileSync(
    join(dir, "identity.json"),
    JSON.stringify(
      {
        ...agent.identity,
        accepted,
        ...(options.ownerName && options.ownerName !== agent.identity.name
          ? { ownerName: options.ownerName }
          : {}),
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "mandate.jws"), agent.mandateJws);
  writeFileSync(join(dir, "representation.jws"), agent.representationJws);
  writeFileSync(join(dir, "trust.json"), JSON.stringify(agent.trust, null, 2));
  writeFileSync(join(dir, "card.json"), JSON.stringify(agent.card, null, 2));
  return dir;
}

/** A service directory as the RUNTIME sees it: no owner private material. */
export interface StoredAgent {
  readonly dir: string;
  readonly identity: Identity & { accepted: string[] };
  readonly actorKey: SigningKey;
  readonly mandateJws: string;
  readonly representationJws: string;
  readonly trust: TrustStoreData;
  readonly card: IntroductionCard;
  /** Whether an owner key sits in the service directory (compatibility layout). */
  readonly ownerCustody: "separate" | "colocated";
}

/** Open a service directory. Never reads the owner's private key (see `readOwnerKey`). */
export async function readAgent(root: string, name: string): Promise<StoredAgent> {
  const dir = agentDir(root, name);
  if (!existsSync(join(dir, "identity.json"))) throw new Error(`no agent ${name} under ${root}`);
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  const actor = JSON.parse(read("keys/actor.private.jwk.json")) as { alg: KeyAlg; jwk: JWK };
  return {
    dir,
    identity: JSON.parse(read("identity.json")),
    ownerCustody: existsSync(join(dir, COLOCATED_OWNER_KEY)) ? "colocated" : "separate",
    actorKey: await loadSigningKey(actor.jwk, actor.alg),
    mandateJws: read("mandate.jws").trim(),
    representationJws: read("representation.jws").trim(),
    trust: JSON.parse(read("trust.json")),
    card: JSON.parse(read("card.json")),
  };
}

/**
 * The owner's signing key, for an explicit owner-signing command only. With `ownerDir` it is
 * read from `ownerDir/<name>/`; without it, only a COLOCATED key (compatibility layout) is used.
 * The key must be the agent's published party key (card), so a wrong directory cannot sign.
 */
export async function readOwnerKey(
  root: string,
  name: string,
  ownerDir?: string,
): Promise<{ key: SigningKey; custody: "separate" | "colocated" }> {
  const dir = agentDir(root, name);
  // An agent of a multi-actor organisation names its (shared) owner key in identity.json.
  const ownerName =
    (JSON.parse(readFileSync(join(dir, "identity.json"), "utf8")) as { ownerName?: string })
      .ownerName ?? name;
  const path = ownerDir
    ? ownerKeyPath(resolve(ownerDir), ownerName)
    : join(dir, COLOCATED_OWNER_KEY);
  if (!existsSync(path))
    throw new Error(
      ownerDir
        ? `no owner key for ${name} in the given owner directory`
        : `the owner key of ${name} is not in its service directory (separate custody): pass --owner-dir DIR`,
    );
  const owner = JSON.parse(readFileSync(path, "utf8")) as { alg: KeyAlg; jwk: JWK };
  const key = await loadSigningKey(owner.jwk, owner.alg);
  const card = JSON.parse(readFileSync(join(dir, "card.json"), "utf8")) as IntroductionCard;
  if (key.kid !== card.partyKey.kid)
    throw new Error(`that owner key is not ${name}'s published party key; nothing signed`);
  return { key, custody: ownerDir ? "separate" : "colocated" };
}

/**
 * An existing owner key by NAME from an owner directory (for provisioning a further actor of
 * the same organisation), or undefined if none exists yet.
 */
export async function existingOwnerKey(
  ownerDir: string,
  ownerName: string,
): Promise<SigningKey | undefined> {
  const path = ownerKeyPath(resolve(ownerDir), ownerName);
  if (!existsSync(path)) return undefined;
  const owner = JSON.parse(readFileSync(path, "utf8")) as { alg: KeyAlg; jwk: JWK };
  return loadSigningKey(owner.jwk, owner.alg);
}

export function saveTrust(root: string, name: string, trust: TrustStoreData): void {
  writeFileSync(join(agentDir(root, name), "trust.json"), JSON.stringify(trust, null, 2));
}
