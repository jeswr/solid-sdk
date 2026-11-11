// AUTHORED-BY Claude Opus 5.5
//
// Owner approval keys: listing and safe revocation. Verifiers accept a control only while its
// signing key is in the owner's profile, so removing a key would silently drop every statement
// it signed, including an in-force Halt. Revocation therefore re-signs the in-force restrictive
// controls with this device's key first, verifies each copy, and only then edits the profile.
// Only restrictive statements are re-signed: the key may be revoked because it was lost, and
// re-signing a Resume or a reconnect would launder whatever that key signed into a trusted one.
// Permissive statements lapse, which can only leave the agent more restricted.
// No device names are published: the profile is public, so rows show the creation date from the
// key id, and "this device" comes from local storage.

import {
  type ControlStatementClaims,
  issueControlStatement,
  readControlVerificationMethod,
} from "@jeswr/agent-mandate/control";
import { parseRdf } from "@jeswr/fetch-rdf";
import { SEC_ASSERTION_METHOD } from "@jeswr/solid-vc";
import { DataFactory, Store } from "n3";
import type { AgentClient } from "./client";
import { isLoaded } from "./client";
import { approvalKeyStatus, deviceKeyId, removeApprovalKey, withApprovalKey } from "./keys";
import { currentCredential, migrateStatusList } from "./mandates";
import { type ProfileSession, profileReader } from "./profile";
import { type DisplayControl, readControl } from "./readers";
import { createAgentVerifier } from "./verify";

const KEY_ID = /#agent-approval-(\d{4})(\d{2})(\d{2})-[0-9a-f]{8}$/;
/** Kinds that can only restrict the agent. One-shot DispatchNow and Forget are not re-signed. */
const RESTRICTIVE_KINDS: readonly string[] = ["Halt", "RevokeMandate", "Archive"];
/** Kinds whose loss changes standing state. */
const STATE_KINDS: readonly string[] = [...RESTRICTIVE_KINDS, "Resume", "SetBindingState"];

type Effect = "restrictive" | "permissive" | "mixed";
const LIMITING_STATES: readonly (string | undefined)[] = [undefined, "disabled", "none"];

/**
 * What a statement does to the agent. A binding change that disables an account or turns an
 * action off restricts; one that connects an account or turns an action on permits. One that does
 * both is mixed: re-signing it would carry its permissive part forward, and letting it lapse would
 * drop its restrictive part, so revocation refuses until it expires.
 */
function effect(claims: ControlStatementClaims): Effect {
  if (RESTRICTIVE_KINDS.includes(claims.kind)) return "restrictive";
  if (claims.kind !== "SetBindingState") return "permissive";
  const restrictions = Object.values(claims.restrictions ?? {});
  const permits =
    !LIMITING_STATES.includes(claims.bindingState) || restrictions.some((on) => on === true);
  const limits =
    (claims.bindingState !== undefined && LIMITING_STATES.includes(claims.bindingState)) ||
    restrictions.some((on) => on !== true);
  if (!permits) return "restrictive";
  return limits ? "mixed" : "permissive";
}

export interface ApprovalKeyRow {
  id: string;
  /** Calendar date (YYYY-MM-DD) taken from the key id. */
  created: string;
  thisDevice: boolean;
}

/** The owner's agent approval keys, newest first, read from the public profile. */
export async function listApprovalKeys(session: ProfileSession): Promise<ApprovalKeyRow[]> {
  const profile = new URL(session.webId);
  profile.hash = "";
  const response = await profileReader(session)(profile.href, {
    redirect: "error",
    headers: { accept: "text/turtle" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Couldn't read your account profile. Try again.");
  const store = new Store([
    ...(await parseRdf(await response.text(), response.headers.get("content-type"), {
      baseIRI: profile.href,
    })),
  ]);
  const device = deviceKeyId();
  const rows: ApprovalKeyRow[] = [];
  for (const q of store.match(
    DataFactory.namedNode(session.webId),
    DataFactory.namedNode(SEC_ASSERTION_METHOD),
    null,
  )) {
    const match = q.object.termType === "NamedNode" ? KEY_ID.exec(q.object.value) : null;
    if (!match || !q.object.value.startsWith(`${profile.href}#`)) continue;
    rows.push({
      id: q.object.value,
      created: `${match[1]}-${match[2]}-${match[3]}`,
      thisDevice: q.object.value === device,
    });
  }
  return rows.sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
}

interface Signed {
  url: string;
  claims: ControlStatementClaims;
}

/**
 * In-force, owner-attributed state-bearing controls whose proof names `id`. Fails closed: an
 * incomplete listing, an unreadable document, a statement by this key whose key check couldn't be
 * completed, or a mixed-effect statement all stop revocation before anything is written.
 */
async function signedBy(
  client: AgentClient,
  session: ProfileSession,
  id: string,
  now: Date,
): Promise<{ restrictive: Signed[]; lapsing: number }> {
  const verifier = createAgentVerifier(session, () => now);
  const found: Signed[] = [];
  let lapsing = 0;
  for (const container of [client.paths.control, client.paths.archive]) {
    const rows = await readControl(client, verifier, container);
    if (!rows.complete) throw new Error("There are too many agent controls to check this key.");
    if (rows.some((row) => !isLoaded(row)))
      throw new Error(
        "Some of your agent's controls couldn't be read, so the key was kept. Try again.",
      );
    for (const row of rows.filter(isLoaded<DisplayControl>)) {
      const { verification, ...claims } = row.record;
      if (
        !STATE_KINDS.includes(claims.kind) ||
        claims.attributedTo !== session.webId ||
        Date.parse(claims.createdAt) > now.getTime() ||
        !(Date.parse(claims.expires) > now.getTime())
      )
        continue;
      const document = await client.graph(row.url);
      if ((await readControlVerificationMethod(document.text, row.url)) !== id) continue;
      if (verification !== "verified") {
        // The key is listed (checked before the scan), so a key failure here means its check
        // couldn't finish, not that the statement was never trusted. Other failures are final.
        if (typeof verification === "object" && verification.invalid !== "key") continue;
        throw new Error(
          "Couldn't check one of your agent's controls signed with this key, so the key was kept. Try again.",
        );
      }
      const kind = effect(claims);
      if (kind === "mixed")
        throw new Error(
          "This key recently changed an account so that your agent can do some things and not others. Revoke it after that change expires, within a day.",
        );
      if (kind === "restrictive") found.push({ url: row.url, claims });
      else lapsing += 1;
    }
  }
  return { restrictive: found, lapsing };
}

export interface RevocationImpact {
  /** Restrictive statements that will be signed again with this device's key. */
  statements: number;
  /** Permissive statements (Resume, reconnects, allowed actions) that stop counting. */
  lapsing: number;
  /** The agent's current permissions were signed with this key and will need granting again. */
  permissions: boolean;
}

function assertRevocable(session: ProfileSession, id: string) {
  if (profileReader(session) !== session.fetch)
    throw new Error(
      "Your profile is outside the storage you shared, so keys can't be changed here.",
    );
  if (id === deviceKeyId())
    throw new Error("This device can't revoke its own key. Revoke it from another device.");
}

/** What revoking `id` would change, for the confirmation dialog. */
export async function revocationImpact(
  client: AgentClient,
  session: ProfileSession,
  id: string,
  now = new Date(),
): Promise<RevocationImpact> {
  assertRevocable(session, id);
  const { restrictive, lapsing } = await signedBy(client, session, id, now);
  // An unverifiable current mandate already grants nothing, so it needs no warning here.
  const current = await currentCredential(client).catch(() => undefined);
  return {
    statements: restrictive.length,
    lapsing,
    permissions: [current?.vc.proof].flat().some((proof) => proof?.verificationMethod === id),
  };
}

/**
 * Revoke one approval key. Requires a ready key on this device, re-signs every in-force
 * restrictive control the key signed (same claims and creation time, a new id that names the
 * original), verifies and stores every copy, and only then removes the key from the profile.
 */
export async function revokeApprovalKey(
  client: AgentClient,
  session: ProfileSession,
  id: string,
  now = () => new Date(),
): Promise<{ resigned: number }> {
  assertRevocable(session, id);
  if (!(await listApprovalKeys(session)).some((key) => key.id === id))
    throw new Error("That key isn't one of your agent approval keys.");
  const survivor = deviceKeyId();
  if (!survivor || (await approvalKeyStatus(session)) !== "ready")
    throw new Error("Set up this device's key before revoking another one.");
  const at = now();
  const { restrictive: pending } = await signedBy(client, session, id, at);
  const verifier = createAgentVerifier(session, () => at);
  for (const { url, claims } of pending) {
    const copy = {
      ...claims,
      id: `${url.replace(/\.trig$/, "")}.resigned-${crypto.randomUUID()}.trig`,
    };
    const document = await withApprovalKey(session, (key) => issueControlStatement(copy, key, at));
    // The profile changes only after every copy verifies under this device's key and is stored.
    if ((await verifier.verifyControl(document, copy.id)) !== "verified")
      throw new Error("Couldn't re-sign your agent's controls, so the key was kept. Try again.");
    await client.create(copy.id, document, "application/trig");
  }
  await migrateStatusList(client, session, id, at);
  await removeApprovalKey(session, id, survivor);
  return { resigned: pending.length };
}
