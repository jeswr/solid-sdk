// AUTHORED-BY Codex GPT-6.1-Sol
/** Callers must exclude exception text, bodies and credentials before logging. */
export function scrubLog(message: string): string {
  return message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, "[url]")
    .replace(/(?:[A-Za-z]:[\\/]|~?\/)[^\r\n<>"']*/g, "[path]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[account]")
    .replace(/[\r\n\t]/g, " ");
}
