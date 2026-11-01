// AUTHORED-BY Codex GPT-6.1-Sol
/** DS-02 presence hues, in the same order as the app colour table. */
export const presenceHues = [
  205, 250, 280, 150, 40, 320, 85, 350, 300, 170, 20, 335, 130, 10, 225,
] as const;

/** FNV-1a over the account identifier: stable across tabs, devices and sessions. */
export function accountHue(webId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < webId.length; index++)
    hash = Math.imul(hash ^ webId.charCodeAt(index), 16777619);
  return presenceHues[(hash >>> 0) % presenceHues.length] as number;
}
