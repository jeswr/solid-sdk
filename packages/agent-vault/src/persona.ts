// AUTHORED-BY Codex GPT-6.1-Sol
import type { Account, Profiles } from "./profiles.js";
export interface PersonaContext {
  profileHint?: string;
  emailDomain?: string;
  lastUsed?: string;
}
export type AccountResolution =
  | { account: Account }
  | { ask: { question: string; candidates: Account[] } };
/** Hints are hard filters; lastUsed is an explicit account id tie-breaker, never inferred recency. */
export class PersonaResolver {
  readonly #profiles: Profiles;
  constructor(profiles: Profiles) {
    this.#profiles = profiles;
  }
  resolveAccount(site: string, context: PersonaContext = {}): AccountResolution {
    let candidates = this.#profiles.accounts(site);
    if (context.profileHint)
      candidates = candidates.filter((a) => a.profile === context.profileHint);
    if (context.emailDomain)
      candidates = candidates.filter((a) => a.emailDomain === context.emailDomain?.toLowerCase());
    const last = candidates.find((a) => a.id === context.lastUsed);
    if (last) return { account: last };
    if (candidates.length === 1 && candidates[0]) return { account: candidates[0] };
    return {
      ask: {
        question: candidates.length
          ? "Which account should I use for this site?"
          : "Which account should I add for this site?",
        candidates,
      },
    };
  }
}
