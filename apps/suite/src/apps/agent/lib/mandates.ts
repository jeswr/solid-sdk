// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { Mandate } from "@jeswr/agent-mandate";
import { issueMandate, mandateCredential, mandateToTurtle } from "@jeswr/agent-mandate/issue";
import { createVcMandateVerifier, parseMandateCredential } from "@jeswr/agent-mandate/verify";
import { recordToTurtle } from "@jeswr/agent-model";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import {
  buildBitstringStatusListCredential,
  createBitstringStatusResolver,
  createWebIdKeyResolver,
  credentialToRdf,
  credentialToTurtle,
  DataIntegritySuite,
  digestQuads,
  issue,
  parseStatusListBody,
  readStatusBit,
  statusListCredentialToTurtle,
  type VerifiableCredential,
  verifyCredential,
  withStatusBit,
} from "@jeswr/solid-vc";
import { type AgentClient, AgentReadError, ConflictError, isLoaded, type Row } from "./client";
import { withApprovalKey } from "./keys";
import { AGENT, metadataNode, RDF } from "./paths";
import { type ProfileSession, profileReader } from "./profile";
import { loadedRecords, readControl, readMandateCurrent } from "./readers";
import { createAgentSigner } from "./sign";
import { createAgentVerifier } from "./verify";

export type { EditorValues } from "./mandate-rules";
export {
  allowSimilar,
  buildEditorMandate,
  canAllowSimilar,
  describeMandate,
  editorDefaults,
  editorSchema,
  mandateNamesBinding,
  proposalBadge,
  proposalIntent,
  replyTemplate,
  testsTemplate,
} from "./mandate-rules";

/** Private reads use the credentialed fetch; the owner's public profile uses {@link profileReader}. */
type Session = ProfileSession;

/** The agent's own introduction (descriptors/agent.ttl), never inferred from the owner's identity. */
export async function readAgentIdentity(client: AgentClient): Promise<string | undefined> {
  const identities = new Set<string>();
  let dataset: Awaited<ReturnType<AgentClient["graph"]>>["dataset"];
  try {
    ({ dataset } = await client.graph(client.paths.agentIntroduction));
  } catch (error) {
    if (error instanceof AgentReadError && (error.status === 404 || error.status === 410))
      return undefined;
    throw error;
  }
  for (const q of dataset.match(null, null, null)) {
    if (
      q.predicate.value !== `${RDF}type` ||
      q.object.value !== `${AGENT}ImplementationDescription` ||
      q.graph.termType !== "DefaultGraph"
    )
      continue;
    const node = metadataNode(dataset, q.subject.value);
    const describes = [...node.iris(`${AGENT}describes`)];
    if (describes.length !== 1 || !/^https?:\/\//.test(describes[0] as string))
      throw new Error("The agent's introduction could not be read.");
    identities.add(describes[0] as string);
  }
  if (identities.size > 1) throw new Error("The agent's introductions disagree. Check its setup.");
  return [...identities][0];
}
function resolverOptions(client: AgentClient, session: Session, now: Date) {
  const scopedIo = createPodScopedFetch(client.workspace, {
    fetch: session.fetch,
    maxRedirects: 0,
  });
  const keys = createWebIdKeyResolver({ fetch: profileReader(session) });
  return {
    keys,
    status: createBitstringStatusResolver({
      fetch: scopedIo,
      resolveKey: keys.resolveKey,
      isControlledBy: keys.isControlledBy,
      now,
      trustedStatusIssuers: [session.webId],
    }),
  };
}
async function currentCredential(client: AgentClient) {
  const reference = (await readMandateCurrent(client))[0];
  if (!reference) return undefined;
  const doc = await client.graph(reference.record.credential);
  const vc = await parseMandateCredential(doc.text);
  if (
    !vc ||
    vc.id !== reference.record.credential ||
    (await digestQuads(credentialToRdf(vc))) !== reference.record.digest
  )
    throw new Error("Your current permissions could not be verified.");
  return { reference, vc };
}
export async function loadVerifiedMandate(
  client: AgentClient,
  session: Session,
  now = new Date(),
): Promise<Mandate | undefined> {
  const agent = await readAgentIdentity(client);
  if (!agent) return undefined;
  const current = await currentCredential(client);
  if (!current) return undefined;
  const { keys, status } = resolverOptions(client, session, now);
  return createVcMandateVerifier({
    read: async () => current.vc,
    ownerWebId: session.webId,
    agentWebId: agent,
    statusListCredential: client.paths.mandatesStatus,
    webIdKeyResolver: keys,
    resolveStatus: status,
    now: () => now,
  }).load();
}
export function statusIndex(vc: VerifiableCredential): number {
  const entries = Array.isArray(vc.credentialStatus) ? vc.credentialStatus : [vc.credentialStatus];
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    !entry ||
    !/^(0|[1-9][0-9]*)$/.test(entry.statusListIndex) ||
    !Number.isSafeInteger(Number(entry.statusListIndex))
  )
    throw new Error("The permission status is invalid.");
  return Number(entry.statusListIndex);
}
export function nextStatusIndex(credentials: readonly VerifiableCredential[]): number {
  const next = Math.max(-1, ...credentials.map(statusIndex)) + 1;
  if (!Number.isSafeInteger(next)) throw new Error("The permission status list is full.");
  return next;
}
export async function readMandateCredentials(
  client: AgentClient,
): Promise<Row<VerifiableCredential>[]> {
  const rows: Row<VerifiableCredential>[] = [];
  for (const m of await client.list(client.paths.mandates)) {
    if (m.container || [client.paths.mandatesCurrent, client.paths.mandatesStatus].includes(m.url))
      continue;
    try {
      const doc = await client.graph(m.url);
      const vc = await parseMandateCredential(doc.text);
      // Legacy reference records point at credentials listed separately.
      if (!vc) {
        await client.read(m.url, "mandate-reference");
        continue;
      }
      if (vc.id !== m.url) throw new Error("A permission record has the wrong address.");
      rows.push({ record: vc, url: m.url, etag: doc.etag, verified: "unchecked" });
    } catch (error) {
      rows.push({ url: m.url, error });
    }
  }
  return rows.sort(
    (a, b) =>
      (isLoaded(b) ? Date.parse(b.record.validFrom as string) : 0) -
      (isLoaded(a) ? Date.parse(a.record.validFrom as string) : 0),
  );
}
async function readStatus(client: AgentClient, session: Session, now: Date) {
  let doc: Awaited<ReturnType<AgentClient["statusDocument"]>>;
  try {
    doc = await client.statusDocument(client.paths.mandatesStatus);
  } catch (e) {
    if (e instanceof AgentReadError && e.status === 404) return undefined;
    throw e;
  }
  // The same negotiation and strict parse as verification, so a JSON-LD list renews and revokes.
  const vc = await parseStatusListBody(doc.text, client.paths.mandatesStatus, "revocation");
  const keys = createWebIdKeyResolver({ fetch: profileReader(session) });
  if (
    !vc ||
    vc.id !== client.paths.mandatesStatus ||
    !(
      await verifyCredential(vc, {
        resolveKey: keys.resolveKey,
        isControlledBy: keys.isControlledBy,
        trustedIssuers: [session.webId],
        now:
          Date.parse(vc.validUntil as string) <= now.getTime()
            ? new Date(vc.validFrom as string)
            : now,
      })
    ).verified ||
    !doc.etag
  )
    throw new Error("Your permission status could not be verified.");
  return { vc, etag: doc.etag };
}
export async function previewMandate(m: Mandate, client: AgentClient): Promise<string> {
  return credentialToTurtle(
    mandateCredential(m, {
      statusListCredential: client.paths.mandatesStatus,
      statusListIndex: "0",
    }),
  );
}
/** Activate before revoking: a failed pointer CAS must leave the old mandate valid. */
export async function activateMandate(
  client: AgentClient,
  session: Session,
  m: Mandate,
  now = new Date(),
  expectedCurrent?: Mandate,
) {
  const agent = await readAgentIdentity(client);
  if (
    !m.id.startsWith(client.paths.mandates) ||
    [client.paths.mandatesCurrent, client.paths.mandatesStatus].includes(m.id) ||
    !agent ||
    m.subject !== agent ||
    m.issuer !== session.webId ||
    Date.parse(m.validFrom) > now.getTime() ||
    Date.parse(m.validUntil) <= now.getTime() ||
    Date.parse(m.validUntil) > now.getTime() + 365 * 86400000
  )
    throw new Error("Check the agent and expiry before signing.");
  const previous = await currentCredential(client);
  let sourceIndex: number | undefined;
  if (expectedCurrent) {
    if (!previous || expectedCurrent.id !== previous.vc.id)
      throw new Error("Your permissions changed. Review them and try again.");
    sourceIndex = statusIndex(previous.vc);
    const entries = Array.isArray(previous.vc.credentialStatus)
      ? previous.vc.credentialStatus
      : [previous.vc.credentialStatus];
    const entry = entries[0];
    const expectedDigest = await digestQuads(
      credentialToRdf(
        mandateCredential(expectedCurrent, {
          statusListCredential: client.paths.mandatesStatus,
          statusListIndex: String(statusIndex(previous.vc)),
          ...(entry?.id ? { id: entry.id } : {}),
        }),
      ),
    );
    if (expectedDigest !== previous.reference.record.digest)
      throw new Error("Your permissions changed. Review them and try again.");
  }
  if (previous && !previous.reference.etag)
    throw new Error("Your permissions do not support safe updates.");
  const oldStatus = await readStatus(client, session, now);
  if (sourceIndex !== undefined && (!oldStatus || (await readStatusBit(oldStatus.vc, sourceIndex))))
    throw new Error("These permissions have stopped. Review and sign new permissions first.");
  const history = await readMandateCredentials(client);
  if (history.some((row) => !isLoaded(row)))
    throw new Error("A permission record could not be read. Check history before signing.");
  const credentials = loadedRecords(history);
  const index = nextStatusIndex(credentials);
  if (!oldStatus && credentials.length)
    throw new Error("Your permission status is missing. Check the agent's setup.");
  if (oldStatus) await readStatusBit(oldStatus.vc, index);
  return withApprovalKey(session, async (key) => {
    const vc = await issueMandate(
      m,
      key,
      { statusListCredential: client.paths.mandatesStatus, statusListIndex: String(index) },
      { cryptosuite: "ecdsa-rdfc-2019" },
    );
    let list =
      oldStatus?.vc ??
      (await buildBitstringStatusListCredential({
        id: client.paths.mandatesStatus,
        issuer: session.webId,
        statusPurpose: "revocation",
        validFrom: now.toISOString(),
        validUntil: new Date(now.getTime() + 366 * 86400000).toISOString(),
      }));
    // Extend freshness while preserving all allocated revocation bits.
    list = { ...list, validUntil: new Date(now.getTime() + 366 * 86400000).toISOString() };
    const signed = await issue({
      credential: list,
      key,
      suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
      options: { created: now },
    });
    const reference = {
      type: "mandate-reference" as const,
      id: client.paths.mandatesCurrent,
      credential: m.id,
      credentialStatus: client.paths.mandatesStatus,
      digest: await digestQuads(credentialToRdf(vc)),
      validFrom: m.validFrom,
      validUntil: m.validUntil,
    };
    const pointer = await recordToTurtle(reference);
    await client.create(m.id, await mandateToTurtle(vc), "application/trig");
    const statusBody = await statusListCredentialToTurtle(signed);
    if (oldStatus)
      await client.replace(
        client.paths.mandatesStatus,
        statusBody,
        oldStatus.etag,
        "application/trig",
      );
    else await client.create(client.paths.mandatesStatus, statusBody, "application/trig");
    if (previous)
      await client.replace(
        client.paths.mandatesCurrent,
        pointer,
        previous.reference.etag as string,
      );
    else await client.create(client.paths.mandatesCurrent, pointer);
    if (previous) {
      const retry = () => revokeStatus(client, session, statusIndex(previous.vc));
      try {
        await revokeStatus(client, session, statusIndex(previous.vc), now);
      } catch {
        throw new PendingRevocation(
          "Your new permissions are active. The old ones couldn't be switched off yet.",
          retry,
        );
      }
    }
    return vc;
  });
}

/** The retry captures only unfinished revocation work; it never signs another mandate. */
export class PendingRevocation extends Error {
  readonly retry: () => Promise<unknown>;
  constructor(message: string, retry: () => Promise<unknown>) {
    super(message);
    this.retry = async () => {
      try {
        return await retry();
      } catch (error) {
        if (error instanceof PendingRevocation) throw error;
        throw new PendingRevocation(message, retry);
      }
    };
  }
}
async function revokeStatus(
  client: AgentClient,
  session: Session,
  index: number,
  now = new Date(),
) {
  for (let attempt = 0; ; attempt++) {
    const list = await readStatus(client, session, now);
    if (!list) throw new Error("Your permission status is missing.");
    if (await readStatusBit(list.vc, index)) return;
    try {
      await withApprovalKey(session, async (key) => {
        const changed = await withStatusBit(list.vc, index, true);
        const signed = await issue({
          credential: changed,
          key,
          suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
          options: { created: now },
        });
        await client.replace(
          client.paths.mandatesStatus,
          await statusListCredentialToTurtle(signed),
          list.etag,
          "application/trig",
        );
      });
      return;
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt >= 2) throw error;
    }
  }
}
export async function revokeMandate(client: AgentClient, session: Session, now = new Date()) {
  const current = await currentCredential(client);
  if (!current) throw new Error("There are no current permissions to stop.");
  const target = current.vc.id as string;
  const index = statusIndex(current.vc);
  const control = () => createAgentSigner(session, client).signControl("RevokeMandate", { target });
  const finish = async (at = new Date()) => {
    await revokeStatus(client, session, index, at);
    try {
      await createAgentSigner(session, client, () => at).signControl("RevokeMandate", { target });
    } catch {
      throw new PendingRevocation(
        "These permissions have stopped. The agent couldn't be notified yet.",
        control,
      );
    }
  };
  try {
    await finish(now);
  } catch (error) {
    if (error instanceof PendingRevocation) throw error;
    throw new PendingRevocation("Couldn't update your permission status yet. Try again.", finish);
  }
}

export interface MandateHistory {
  id: string;
  validFrom?: string;
  validUntil?: string;
  status: "active" | "replaced" | "revoked" | "expired" | "unchecked" | "unreadable";
  key: string;
}
export async function mandateHistory(
  client: AgentClient,
  session: Session,
  now = new Date(),
): Promise<MandateHistory[]> {
  const credentials = await readMandateCredentials(client);
  const current = await currentCredential(client);
  const list = await readStatus(client, session, now);
  // History retains a signed revocation after its delivery window expires. It is
  // evidence of the past event, while current authority still requires a fresh list.
  const controls = await Promise.all(
    loadedRecords(await readControl(client)).map(async (control) => {
      if (control.kind !== "RevokeMandate" || Date.parse(control.createdAt) > now.getTime())
        return control;
      const document = await client.graph(control.id);
      const verification = await createAgentVerifier(
        session,
        () => new Date(control.createdAt),
      ).verifyControl(document.text, control.id);
      return { ...control, verification };
    }),
  );
  const keys = createWebIdKeyResolver({ fetch: profileReader(session) });
  return Promise.all(
    credentials.map(async (row): Promise<MandateHistory> => {
      if (!isLoaded(row)) return { id: row.url, status: "unreadable", key: "Couldn't be checked" };
      const vc = row.record;
      const unchecked: MandateHistory = {
        id: vc.id as string,
        validFrom: vc.validFrom as string,
        validUntil: vc.validUntil as string,
        key: "Couldn't be checked",
        status: "unchecked",
      };
      try {
        if (
          !(
            await verifyCredential(vc, {
              resolveKey: keys.resolveKey,
              isControlledBy: keys.isControlledBy,
              trustedIssuers: [session.webId],
              now: new Date(vc.validFrom as string),
            })
          ).verified
        )
          return unchecked;
        const revoked = list ? await readStatusBit(list.vc, statusIndex(vc)) : true;
        const explicit = controls.some(
          (c) => c.kind === "RevokeMandate" && c.target === vc.id && c.verification === "verified",
        );
        const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
        return {
          id: vc.id as string,
          validFrom: vc.validFrom as string,
          validUntil: vc.validUntil as string,
          key: proof.verificationMethod.split("#").at(-1) as string,
          status:
            Date.parse(vc.validUntil as string) <= now.getTime()
              ? "expired"
              : explicit || (revoked && current?.vc.id === vc.id)
                ? "revoked"
                : current?.vc.id === vc.id && !revoked
                  ? "active"
                  : "replaced",
        };
      } catch {
        return unchecked;
      }
    }),
  );
}
