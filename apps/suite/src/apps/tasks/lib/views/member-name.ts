// AUTHORED-BY Codex GPT-6.1-Sol
export function memberName(webId: string) {
  let displayName = webId;
  try {
    displayName = new URL(webId).hostname;
  } catch {
    /* Keep foreign IRIs renderable. */
  }
  return displayName;
}
