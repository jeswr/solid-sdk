// AUTHORED-BY Codex GPT-6.1-Sol
import { validateSubject } from "./validation";

export function subjectInfo(subject: string): { base: string; isReply: boolean } {
  validateSubject(subject);
  let base = subject.replace(/\s+/gu, " ").trim();
  let isReply = false;
  for (;;) {
    const prefix = /^(?:re|fwd?|aw|sv)(?:\[\d+\])?\s*:\s*/iu.exec(base);
    if (prefix) {
      isReply = true;
      base = base.slice(prefix[0].length).trim();
      continue;
    }
    const tag = /^\[[^[\]]+\]\s*/u.exec(base);
    if (tag) {
      base = base.slice(tag[0].length).trim();
      continue;
    }
    return { base: base.toLowerCase(), isReply };
  }
}

/** Matching key, not a replacement for the original display subject. */
export function normalizeSubject(subject: string): string {
  return subjectInfo(subject).base;
}
