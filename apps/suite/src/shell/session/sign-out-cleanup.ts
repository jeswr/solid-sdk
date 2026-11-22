// AUTHORED-BY Codex GPT-6
import type { SuiteAccount } from "./types";

const handlers = new Set<(account: SuiteAccount) => Promise<void>>();

/** Cleanup that needs the live session runs before credentials or the shell row disappear. */
export function onBeforeSignOut(handler: (account: SuiteAccount) => Promise<void>): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function beforeSignOut(account: SuiteAccount): Promise<void> | undefined {
  if (!handlers.size) return undefined;
  return (async () => {
    for (const handler of handlers) await handler(account);
  })();
}
