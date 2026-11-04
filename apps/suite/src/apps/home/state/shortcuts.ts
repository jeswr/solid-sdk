// AUTHORED-BY Codex GPT-6
/** Shared by Home and Connect; read at keydown so preference changes apply immediately. */
export function shortcutsEnabled(): boolean {
  try {
    return localStorage.getItem("suite.settings.shortcuts") !== "off";
  } catch {
    return true;
  }
}
