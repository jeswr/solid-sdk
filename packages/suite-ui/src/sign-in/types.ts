// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";

export interface SignInProvider {
  id: string;
  name: string;
  issuer: string;
  description?: string;
  signUpUrl?: string;
  label?: string;
  iconUrl?: string;
}

export interface SignInRecentAccount {
  webId: string;
  name?: string;
  photoUrl?: string;
}

export interface SignInCardProps {
  title?: string;
  subtitle?: string;
  recentAccounts?: SignInRecentAccount[];
  /** Ordered by the host: the first provider is the primary home provider. */
  providers: SignInProvider[];
  recentProviders?: string[];
  allowCustomProvider?: boolean;
  /** Provider key: id or issuer. Account key: WebID. Form key: submitted input. */
  pending?: {
    kind: "webid" | "provider" | "account" | "custom";
    key: string;
  } | null;
  error?: string | null;
  onWebId(input: string): void;
  onProvider(provider: SignInProvider): void;
  onCustomProvider(input: string): void;
  onAccount(account: SignInRecentAccount): void;
  onCancel?(): void;
  footer?: ReactNode;
  webIdHelpHref?: string;
}
