// AUTHORED-BY Codex GPT-6
import { ProviderRejectedError, SendNotDispatchedError } from "../errors.js";
import type { ProviderSendResult } from "../types.js";

/** Only an effectful send dispatch creates delivery uncertainty; read preflights do not. */
export async function sendAttempt(
  send: (dispatched: () => void) => Promise<ProviderSendResult>,
): Promise<ProviderSendResult> {
  let dispatched = false;
  try {
    return await send(() => {
      dispatched = true;
    });
  } catch (error) {
    if (dispatched || error instanceof ProviderRejectedError) throw error;
    throw new SendNotDispatchedError(error);
  }
}
