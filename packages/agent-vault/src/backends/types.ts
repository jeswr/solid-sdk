// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import type { Purpose } from "../permission.js";
import type { Secret } from "../safe.js";
export const loginSchema = z.strictObject({
  site: z.string(),
  username: z.string().min(1).max(1000),
  password: z.string().min(1).max(8192),
  title: z.string().min(1).max(200),
  ref: z.string().max(200).optional(),
  totp: z.string().max(200).optional(),
});
export type LoginItem = z.infer<typeof loginSchema>;
export interface SecretRef {
  backend: string;
  ref: string;
  profile: string;
}
export interface SecretBackend {
  readonly id: string;
  readonly profiles?: readonly string[];
  profileFor?(ref?: string): string | undefined;
  allowsOrigin?(site: string, credentialSite: string): boolean;
  find(siteOrigin: string): Promise<SecretRef[]>;
  read(ref: string, purpose: "login"): Promise<Secret<LoginItem>>;
  save(item: Secret<LoginItem>): Promise<SecretRef>;
  totp?(ref: string): Promise<Secret<string>>;
}
export interface SecretAccess {
  site: string;
  account: string;
  backend: string;
  purpose: Purpose;
}
