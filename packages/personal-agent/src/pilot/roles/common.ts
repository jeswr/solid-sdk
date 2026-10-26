/** Small helpers shared by role definitions (files and locally provisioned issuer anchors). */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { KeyAlg } from "../mechanisms/jws.js";
import type { TrustStoreData } from "../mechanisms/trust.js";
import { pinIssuer } from "../setup.js";

/** Write a role file atomically, mode 0600. */
export function writeAtomic(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

/** Issuer PUBLIC keys (`synthetic-*` fixtures or `awp-pilot issuer-card`). */
export const issuersFile = z.strictObject({
  version: z.literal(1),
  issuers: z
    .array(
      z.strictObject({
        issuer: z.string().max(512),
        kid: z.string().min(16).max(128),
        alg: z.enum(["EdDSA", "ES256"]),
        publicJwk: z.strictObject({
          kty: z.string(),
          crv: z.string().optional(),
          x: z.string().optional(),
          y: z.string().optional(),
        }),
      }),
    )
    .max(16),
  note: z.string().max(500).optional(),
});

/**
 * Pin issuer keys from one or more files (comma-separated paths) given at THIS agent's
 * provisioning — local source-authority anchors, never learned from a channel.
 */
export function pinIssuersFromFiles(
  trust: TrustStoreData,
  paths: string,
  note: string,
): TrustStoreData {
  let next = trust;
  for (const path of paths.split(",").filter(Boolean)) {
    const file = issuersFile.parse(JSON.parse(readFileSync(path, "utf8")));
    for (const i of file.issuers)
      next = pinIssuer(
        next,
        i.issuer,
        { kid: i.kid, alg: i.alg as KeyAlg, publicJwk: i.publicJwk } as never,
        note,
      );
  }
  return next;
}
