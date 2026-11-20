// AUTHORED-BY Codex GPT-6
import { digestBytes, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { EvidenceItem } from "../core/types.js";
import { type AccessPointer, signAccessPointer } from "../mechanisms/access-pointer.js";
import type { TranslatedRule } from "../mechanisms/access-translation.js";
import { type SigningKey, verifyCompact } from "../mechanisms/jws.js";
import { type AccessRule, accessDocument, accessModes } from "../model/solid-storage.js";
import type { FictionalSolidStorage } from "./storage.js";

export const WITHDRAW_ACCESS = "urn:op:pod-access-withdraw";
export const POD_ACCESS_ADAPTER = "urn:scenario:pod-access";
export type WithdrawalReason = "principal" | "expiry" | "release-failed";
type RecordAccess = (event: { type: string; [key: string]: unknown }) => void;
type StoredItem = AccessPointer["item"] & { resource: string; digest: string };
export interface PodGrant {
  pointer: AccessPointer;
  fragment: string;
  translated?: TranslatedRule;
}

function receipt(response: Response): string {
  const value = response.headers.get("x-fictional-storage-receipt");
  if (!value) throw new Error("The pod did not provide a receipt");
  return value;
}

export class EvidencePod {
  private readonly items = new Map<string, StoredItem>();
  readonly folder: string;

  constructor(
    readonly storage: FictionalSolidStorage,
    readonly owner: string,
    readonly actor: string,
    private readonly key: SigningKey,
  ) {
    this.folder = `${storage.origin}/sam/evidence/`;
  }

  private ownerRules(resource: string): AccessRule[] {
    return [this.owner, this.actor].map((agent) => ({
      agent,
      resource,
      modes: ["Read", "Write", "Control"],
      defaults: resource === this.folder,
    }));
  }

  async setup(): Promise<void> {
    await this.storage.provision(`${this.storage.origin}/sam/`, this.owner, { container: true });
    await this.storage.provision(this.folder, this.owner, {
      container: true,
      rules: this.ownerRules(this.folder).filter((r) => r.agent === this.actor),
    });
  }

  stored(id: string): StoredItem | undefined {
    return this.items.get(id);
  }

  async store(item: AccessPointer["item"], bytes: string, record: RecordAccess): Promise<void> {
    const resource = this.folder + encodeURIComponent(item.id.slice(item.id.lastIndexOf(":") + 1));
    const client = this.storage.client(this.actor, this.key);
    const put = await client(resource, {
      method: "PUT",
      headers: { "content-type": "application/jose", "if-none-match": "*" },
      body: bytes,
    });
    if (put.status !== 201) throw new Error("The statement could not be stored");
    const acl = await client(`${resource}.acl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body: await accessDocument(`${resource}.acl`, this.ownerRules(resource)),
    });
    if (acl.status !== 201) throw new Error("The statement could not get its own access document");
    const stored = { ...item, resource, digest: digestBytes(bytes) };
    this.items.set(item.id, stored);
    record({ type: "pod-store", ...stored, receipt: receipt(put) });
  }

  private async acl(resource: string) {
    const response = await this.storage.client(this.actor, this.key)(`${resource}.acl`);
    const etag = response.headers.get("etag");
    if (!response.ok || !etag) throw new Error("The access document is unavailable");
    return { body: await response.text(), etag };
  }

  private async writeAcl(resource: string, etag: string, body: string): Promise<Response> {
    return this.storage.client(this.actor, this.key)(`${resource}.acl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-match": etag },
      body,
    });
  }

  async withdraw(
    grant: PodGrant,
    reason: WithdrawalReason,
    record: RecordAccess,
    restore?: { before: string; after: string },
  ): Promise<void> {
    const { pointer: p, fragment } = grant;
    const acl = await this.acl(p.resource);
    const url = `${p.resource}.acl`;
    const removed =
      restore && acl.body === restore.after
        ? restore.before
        : await accessDocument(url, [], acl.body, fragment);
    const response = await this.writeAcl(p.resource, acl.etag, removed);
    if (!response.ok || (await this.acl(p.resource)).body !== removed)
      throw new Error("Withdrawal could not be confirmed");
    record({
      type: "access-withdrawn",
      reason,
      pointer: p.id,
      resource: p.resource,
      reader: p.reader,
      receipt: receipt(response),
    });
  }

  async grantAndRelease<T>(
    grants: readonly PodGrant[],
    actionDigest: string,
    record: RecordAccess,
    release: (pointers: ReadonlyMap<string, EvidenceItem>) => Promise<T>,
    registerWithdrawal?: (grant: PodGrant) => void,
  ): Promise<T> {
    const applied: Array<{ grant: PodGrant; before: string; after: string }> = [];
    const records: Parameters<RecordAccess>[0][] = [];
    const pointers = new Map<string, EvidenceItem>();
    let applying = true;
    try {
      for (const grant of grants) {
        const { pointer: p, fragment } = grant;
        record({
          type: "access-grant-intended",
          resource: p.resource,
          reader: p.reader,
          validUntil: p.validUntil,
          actionDigest,
        });
        const url = `${p.resource}.acl`;
        const before = await this.acl(p.resource);
        const rule = grant.translated ?? {
          agent: p.reader.actor,
          modes: p.modes,
          resource: p.resource,
        };
        const after = await accessDocument(url, [{ ...rule, fragment }], before.body);
        const response = await this.writeAcl(p.resource, before.etag, after);
        if (!response.ok) throw new Error("The access grant could not be written");
        applied.push({ grant, before: before.body, after });
        const confirmed = await this.acl(p.resource);
        const modes = await accessModes(confirmed.body, url, p.resource, p.reader.actor, false);
        if (confirmed.body !== after || modes.size !== 1 || !modes.has("Read"))
          throw new Error("The access grant could not be confirmed");
        records.push({
          type: "access-granted",
          resource: p.resource,
          reader: p.reader,
          modes: p.modes,
          validFrom: p.validFrom,
          validUntil: p.validUntil,
          before: digestBytes(before.body),
          after: digestBytes(confirmed.body),
          receipt: receipt(response),
          pointer: p.id,
          actionDigest,
          agreement: p.agreement,
          termsDigest: p.terms.termsDigest,
          ...(p.policies ? { policies: p.policies } : {}),
        });
      }
      applying = false;
      for (const grant of grants) {
        const p = grant.pointer;
        const value = await signAccessPointer(this.key, p);
        pointers.set(p.item.id, { role: "grant", format: "jws-compact", value });
        const entry = records.find((entry) => entry.pointer === p.id);
        if (entry) entry.pointerDigest = digestBytes(value);
      }
      const result = await release(pointers);
      for (const entry of records) record(entry);
      for (const grant of grants) registerWithdrawal?.(grant);
      return result;
    } catch (error) {
      if (applying) record({ type: "access-grant-failed", actionDigest });
      let rollbackIncomplete = false;
      for (const { grant, before, after } of applied.reverse()) {
        try {
          await this.withdraw(grant, "release-failed", record, { before, after });
        } catch {
          rollbackIncomplete = true;
          record({ type: "access-withdrawal-failed", pointer: grant.pointer.id, actionDigest });
        }
      }
      if (rollbackIncomplete)
        throw new Error("The pod could not confirm release rollback", { cause: error });
      throw error;
    }
  }

  async read(pointer: AccessPointer, actor: string, key: SigningKey) {
    const response = await this.storage.client(actor, key)(pointer.resource);
    const body = await response.text();
    const proof = receipt(response);
    const checked = await verifyCompact(proof, {
      typ: "fictional-solid-response+jws",
      resolve: (kid) => (kid === this.storage.key.kid ? this.storage.key : undefined),
      allowedAlgs: ["EdDSA"],
      limits: DEFAULT_LIMITS,
    });
    const expected = {
      method: "GET",
      url: pointer.resource,
      actor,
      status: response.status,
      bodyDigest: digestBytes(body),
    };
    return {
      status: response.status,
      body,
      receipt: proof,
      receiptValid: checked.outcome === "valid" && digestOf(checked.payload) === digestOf(expected),
      digestMatches: expected.bodyDigest === pointer.digest,
      readOnly: /^user="read",public="[^"]*"$/.test(response.headers.get("wac-allow") ?? ""),
    };
  }
}
