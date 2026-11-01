// AUTHORED-BY Codex GPT-6
import { MoneyIoError } from "../model";

/** A retry or a competing writer may already have fulfilled this exact intent. */
export async function reconcileMutation<T>(
  current: T,
  satisfied: (value: T) => boolean,
  write: () => Promise<unknown>,
  read: () => Promise<T>,
  checkBefore = true,
): Promise<void> {
  if (checkBefore && satisfied(current)) return;
  try {
    await write();
  } catch (error) {
    // Never retry a stale write. Confirm its result without overwriting concurrent edits.
    if (error instanceof MoneyIoError && error.status === 412 && satisfied(await read())) return;
    throw error;
  }
}
