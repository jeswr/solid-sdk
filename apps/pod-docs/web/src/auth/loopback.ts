// AUTHORED-BY Codex GPT-6
/** The host's existing authentication opt-in, also used for identity document reads. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}
