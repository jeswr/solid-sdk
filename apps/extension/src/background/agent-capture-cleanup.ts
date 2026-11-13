// AUTHORED-BY Codex GPT-6.1-Sol
export const CAPTURE_CLEANUP_KEY = 'agentCaptureCleanup';

/** Display-only, durable notice. Permission cleanup never depends on this marker. */
export async function captureCleanupPending(storage: typeof chrome.storage): Promise<boolean> {
  const values = await storage.local.get(CAPTURE_CLEANUP_KEY);
  return values[CAPTURE_CLEANUP_KEY] !== undefined;
}

export async function markCaptureCleanup(storage: typeof chrome.storage) {
  await storage.local.set({ [CAPTURE_CLEANUP_KEY]: true });
}

/** Clear the notice only after cookie authority is verified absent. */
export async function clearCaptureCleanup(storage: typeof chrome.storage) {
  await storage.local.remove(CAPTURE_CLEANUP_KEY);
}
