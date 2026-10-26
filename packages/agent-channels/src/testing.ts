// AUTHORED-BY Codex GPT-6.1-Sol
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
