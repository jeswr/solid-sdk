// AUTHORED-BY Codex GPT-6
/** Linked Data Notifications subset: discover, POST, list, GET. Bytes stay opaque. */
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import type { ByteMessage } from "../bindings/bytes.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { inboxDescription, readInboxDescription } from "../model/solid-storage.js";
import type { FictionalSolidStorage } from "./storage.js";

export const SOLID_INBOX_BINDING = "solid-inbox/0.1";
export class SolidInboxHost {
  constructor(
    readonly storage: FictionalSolidStorage,
    private readonly parties: ReadonlyMap<string, { actor: string; key: SigningKey }>,
  ) {}
  private inbox(id: string): string {
    return `${this.storage.origin}/${id}/inbox/`;
  }
  private description(id: string): string {
    return `${this.storage.origin}/${id}/description`;
  }
  async setup(): Promise<void> {
    for (const [id, party] of this.parties) {
      this.storage.introduce(party.actor, party.key);
      await this.storage.provision(`${this.storage.origin}/${id}/`, party.actor, {
        container: true,
      });
      await this.storage.provision(this.inbox(id), party.actor, {
        container: true,
        rules: [...this.parties.values()]
          .filter((other) => other.actor !== party.actor)
          .map((other) => ({
            resource: this.inbox(id),
            agent: other.actor,
            modes: ["Append"] as const,
          })),
      });
      await this.storage.provision(this.description(id), party.actor, {
        body: await inboxDescription(party.actor, this.inbox(id)),
        rules: [{ resource: this.description(id), public: true, modes: ["Read"] }],
      });
    }
  }
  async carry(
    message: ByteMessage,
    from: string,
    to: string,
    changedAtRest = false,
  ): Promise<ByteMessage> {
    const sender = this.parties.get(from),
      receiver = this.parties.get(to);
    if (!sender || !receiver)
      throw new Error("The inbox needs separately keyed sender and receiver parties");
    const description = await this.storage.client()(this.description(to));
    if (!description.ok) throw new Error("The receiver description could not be read");
    const inbox = assertWithinPodScope(
      `${this.storage.origin}/`,
      await readInboxDescription(await description.text(), this.description(to), receiver.actor),
    );
    const posted = await this.storage.client(sender.actor, sender.key)(inbox, {
      method: "POST",
      headers: { "content-type": message.mediaType },
      body: Buffer.from(message.bytes),
    });
    if (posted.status !== 201 || !posted.headers.get("location"))
      throw new Error("The storage refused the inbox POST");
    const location = assertWithinPodScope(inbox, posted.headers.get("location") as string, {
      allowRoot: false,
    });
    if (changedAtRest)
      this.storage.alterAtRest(location, (body) => {
        // The hostile operator damages a signature in the stored bytes, without re-signing.
        const changed = body.replace(
          /(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)([A-Za-z0-9_-])/,
          (_all, prefix: string, first: string) => prefix + (first === "A" ? "B" : "A"),
        );
        if (changed === body)
          throw new Error("The hostile fixture did not find a stored JWS signature");
        return changed;
      });
    const reader = this.storage.client(receiver.actor, receiver.key);
    const listing = await readContainerMembers(reader, inbox, { scope: `${this.storage.origin}/` });
    if (!listing?.some((member) => member.url === location))
      throw new Error("The receiver could not find the posted inbox item");
    const read = await reader(location);
    if (!read.ok) throw new Error("The storage refused the receiver's inbox read");
    return {
      bytes: new Uint8Array(await read.arrayBuffer()),
      mediaType: read.headers.get("content-type") ?? "application/octet-stream",
    };
  }
}
