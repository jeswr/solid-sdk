// AUTHORED-BY Codex GPT-6.1-Sol
import { ConnectorVaultError, MAX_VAULT_RECORDS } from "./vault.js";

/** FIFO mutex with bounded retained keys and waiters; entries disappear after release. */
export class VaultMutex {
  private readonly tails = new Map<string, Promise<void>>();
  private pending = 0;
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.pending >= MAX_VAULT_RECORDS) throw new ConnectorVaultError();
    this.pending++;
    const previous = this.tails.get(id);
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(id, current);
    try {
      await previous;
      return await fn();
    } finally {
      release();
      this.pending--;
      if (this.tails.get(id) === current) this.tails.delete(id);
    }
  }
}
