// AUTHORED-BY Codex GPT-6.1-Sol
export function deviceState(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function saveDeviceState(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
export const readMarkerKey = (owner: string, conversation: string) =>
  `agent.lastRead:${owner}:${conversation}`;
export const archiveKey = (owner: string, message: string) => `agent.archived:${owner}:${message}`;
/** Tab-scoped state; blocked storage reads as absent and writes report failure. */
export function tabState(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function saveTabState(key: string, value: string | undefined): boolean {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
