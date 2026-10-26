// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createHash } from "crypto";
import { type CredentialStore, HelperError, type TokenFileProvider } from "./store.js";

/** Consume one successful op read from stdin; stdout is a reference-only receipt. */
export function provisionValue(options: {
  store: CredentialStore;
  provider: TokenFileProvider | "google" | "microsoft";
  account: string;
  purpose: "read" | "send";
  reference: string;
  value: string;
  now: Date;
}): { credentialRef: string } {
  const { store, provider, reference, value } = options;
  if (!/^op:\/\/[^\s/]+\/[^\s/]+\/[^\s]+$/.test(reference))
    throw new HelperError("invalid", "invalid credential reference");
  if (provider === "google") {
    let raw: { installed?: { client_id?: unknown; client_secret?: unknown; token_uri?: unknown } };
    try {
      raw = JSON.parse(value);
    } catch {
      throw new HelperError("invalid", "invalid Google client registration");
    }
    const installed = raw?.installed;
    if (
      !installed ||
      typeof installed.client_id !== "string" ||
      (installed.token_uri !== undefined &&
        installed.token_uri !== "https://oauth2.googleapis.com/token")
    )
      throw new HelperError("invalid", "invalid Google client registration");
    store.putClient({
      version: 1,
      provider,
      clientId: installed.client_id,
      ...(installed.client_secret === undefined
        ? {}
        : { clientSecret: installed.client_secret as string }),
      importedFrom: "1Password",
      importedAt: options.now.toISOString(),
    });
  } else if (provider === "microsoft") {
    store.putClient({
      version: 1,
      provider,
      clientId: value.trim(),
      addedAt: options.now.toISOString(),
    });
  } else {
    const name = `${provider}-${createHash("sha256")
      .update(JSON.stringify([provider, options.account, options.purpose]))
      .digest("hex")
      .slice(0, 20)}`;
    store.replaceTokenFile({
      version: 1,
      name,
      provider,
      account: options.account,
      purpose: options.purpose,
      token: value.replace(/\r?\n$/, ""),
      credentialRef: reference,
    });
  }
  return { credentialRef: reference };
}
