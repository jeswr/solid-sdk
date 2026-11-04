// AUTHORED-BY Codex GPT-6.1-Sol

import type { DiscordGatewaySource } from "./discord.js";
import type { AccountRef, ReadGrant, SendGrant, TokenProvider } from "./types.js";

export { createInMemoryDirectBinding, type DirectOptions } from "./direct/send.js";

/** Deterministic fake that records scope requests without recording credential values. */
export class RecordingTokenProvider implements TokenProvider {
  readonly calls: Array<{ access: "read" | "send"; account: AccountRef }> = [];
  async read(account: AccountRef): Promise<ReadGrant> {
    this.calls.push({ access: "read", account: { ...account } });
    return { access: "read", accessToken: "test-read-token-0123456789" };
  }
  async send(account: AccountRef): Promise<SendGrant> {
    this.calls.push({ access: "send", account: { ...account } });
    return { access: "send", accessToken: "test-send-token-0123456789" };
  }
}

/** Replayable, bounded Gateway fake. Recorded calls deliberately omit credentials. */
export class InMemoryDiscordGateway implements DiscordGatewaySource {
  readonly calls: Array<Omit<Parameters<DiscordGatewaySource["read"]>[0], "accessToken">> = [];
  private readonly events: Map<string, readonly (string | Uint8Array)[]>;
  constructor(events: ReadonlyMap<string, readonly (string | Uint8Array)[]>) {
    this.events = new Map(
      [...events].map(([id, rows]) => [
        id,
        rows.map((raw) => (typeof raw === "string" ? raw : raw.slice())),
      ]),
    );
  }
  async read(options: Parameters<DiscordGatewaySource["read"]>[0]) {
    const { accessToken: _token, ...call } = options;
    this.calls.push(call);
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const rows = this.events.get(options.account.id) ?? [];
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length)
      throw new RangeError("invalid test Gateway offset");
    const events = [];
    let bytes = 0;
    for (const raw of rows.slice(offset, offset + options.limits.maxItems)) {
      if (bytes + Buffer.byteLength(raw) > options.limits.maxBytes) {
        if (events.length === 0) throw new RangeError("next Gateway event exceeds byte bound");
        break;
      }
      bytes += Buffer.byteLength(raw);
      events.push(typeof raw === "string" ? raw : raw.slice());
    }
    return { events, next: String(offset + events.length) };
  }
}
