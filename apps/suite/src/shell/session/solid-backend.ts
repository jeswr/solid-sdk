// AUTHORED-BY Codex GPT-6.1-Sol
import { type SessionBackend, SignInError, type SignInHint, type SuiteAccount } from "./types";

/** Integration seam: replace with one pod-auth session per account when the SDK manager lands.
 * This preview validates discovery input only; it never starts OAuth or sends a request.
 */
export class SolidBackend implements SessionBackend {
  readonly kind = "solid";
  async restore(): Promise<SuiteAccount | null> {
    return null;
  }
  async signIn(hint: SignInHint): Promise<SuiteAccount> {
    const value = "issuer" in hint ? hint.issuer : hint.webId;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      throw new SignInError("invalid-url");
    }
    throw new SignInError("unavailable");
  }
  async signOut(): Promise<void> {}
  fetchFor(): typeof fetch {
    return globalThis.fetch;
  }
  onExpired(): () => void {
    return () => {};
  }
}
