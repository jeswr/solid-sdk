// AUTHORED-BY Codex GPT-6.1-Sol
export const CAPTURE_CLEANUP_KEY = 'agentCaptureCleanup';

export interface CaptureCleanupMarker {
  leaseId: number;
  requestedAt: number;
}

/** Read both areas: a previous worker may have needed the local fallback. */
export async function captureCleanupMarkers(storage: typeof chrome.storage) {
  const markers: { area: chrome.storage.StorageArea; marker: CaptureCleanupMarker }[] = [];
  const read = async (area: chrome.storage.StorageArea) => {
    const values = await area.get(CAPTURE_CLEANUP_KEY);
    if (values[CAPTURE_CLEANUP_KEY] !== undefined)
      markers.push({ area, marker: values[CAPTURE_CLEANUP_KEY] });
  };
  await read(storage.local);
  try {
    if (storage.session) await read(storage.session);
  } catch {
    // Session storage is unavailable in some browser contexts. Local is mandatory.
  }
  return markers;
}

export async function markCaptureCleanup(storage: typeof chrome.storage, leaseId: number) {
  const marker: CaptureCleanupMarker = { leaseId, requestedAt: Date.now() };
  try {
    if (storage.session) {
      await storage.session.set({ [CAPTURE_CLEANUP_KEY]: marker });
      return;
    }
  } catch {
    // Fall back before arming; failure of both stores refuses acquisition.
  }
  await storage.local.set({ [CAPTURE_CLEANUP_KEY]: marker });
}

/** Call only after verified absence, and retain markers for unresolved prompts. */
export async function clearCaptureCleanup(storage: typeof chrome.storage) {
  for (const { area } of await captureCleanupMarkers(storage))
    await area.remove(CAPTURE_CLEANUP_KEY);
}
