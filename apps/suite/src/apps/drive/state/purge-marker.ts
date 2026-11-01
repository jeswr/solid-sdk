// AUTHORED-BY Claude Opus 5.5

const PURGE_KEY = "suite.drive.purged";
/** Roots purged by this tab, for when session storage refuses the marker. */
const purgedHere = new Set<string>();

/** True once per browser session and pod root; unusable session storage falls back to this tab. */
export function claimPurge(driveRoot: string): boolean {
  if (purgedHere.has(driveRoot)) return false;
  purgedHere.add(driveRoot);
  try {
    if (sessionStorage.getItem(PURGE_KEY) === driveRoot) return false;
    sessionStorage.setItem(PURGE_KEY, driveRoot);
  } catch {
    // Storage full or blocked: the in-memory marker still limits this tab to one purge.
  }
  return true;
}
