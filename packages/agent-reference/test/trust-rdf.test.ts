// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { generateSigningKey } from "../src/mechanisms/jws.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore, type TrustStoreData } from "../src/mechanisms/trust.js";
import { trustDataset, trustFromRdf } from "../src/model/store/trust.js";
import { readTrustFile, writeTrustFile } from "../src/setup.js";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";

const owner = "urn:example:owner";
let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

async function trust(): Promise<TrustStoreData> {
  const ownerSigningKey = (await generateSigningKey("EdDSA")).key;
  const keys = await Promise.all(
    (["party", "actor", "issuer"] as const).map(async (role) => {
      const { kid, alg, publicJwk } =
        role === "party" ? ownerSigningKey : (await generateSigningKey("EdDSA")).key;
      return {
        kid,
        alg,
        publicJwk,
        role,
        subject: role === "party" ? owner : "urn:example:" + role,
        ...(role === "actor" && {
          party: owner,
          endpoints: ["mailto:peer@example.test", "https://peer.example.test"],
          note: "Peer",
        }),
      };
    }),
  );
  const { key } = await generateSigningKey("EdDSA");
  const delegation = await signStatement(ownerSigningKey, "awp-record-key+jws", {
    type: "RecordKeyDelegation",
    id: "urn:example:delegation",
    issuer: owner,
    recordKid: key.kid,
    claimTypes: ["test"],
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
  });
  return {
    version: 1,
    owner,
    keys,
    recordKeys: [
      {
        identity: owner,
        key: { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk },
        delegation,
      },
    ],
    controllers: { "urn:example:z": owner, "urn:example:a": owner },
    sourceAuthority: [
      {
        id: "urn:example:r1",
        source: "urn:example:issuer",
        version: "1",
        claimTypes: ["test", "test.*"],
        subjects: "any",
      },
      {
        id: "urn:example:r2",
        source: "urn:example:issuer",
        version: "1",
        claimTypes: ["test"],
        subjects: ["urn:example:b", "urn:example:a"],
        validFrom: "2026-01-01T00:00:00+00:00",
      },
    ],
  };
}

it("round-trips an ordered trust graph and passes it to the original trust verifier", async () => {
  const input = await trust();
  const dataset = trustDataset(input);
  const decoded = trustFromRdf(readNQuads(writeNQuads(dataset)));
  expect(digestOf(decoded)).toBe(digestOf(input));
  expect(Object.keys(decoded.controllers!)).toEqual(Object.keys(input.controllers!));
  const checked = await TrustStore.load(decoded);
  expect(checked.data).toEqual(input);
  expect(checked.resolver("issuer")(input.recordKeys![0]!.key.kid)?.subject).toBe(owner);
  expect(
    checked.recordKeyAllowed(input.recordKeys![0]!.key.kid, "test", "2026-05-01T00:00:00Z"),
  ).toBe(true);
});

it("prefers Turtle and refuses malformed Turtle even when JSON is available", async () => {
  root = mkdtempSync(join(tmpdir(), "awp-trust-test-"));
  const input = await trust();
  const json = join(root, "trust.json");
  const turtle = join(root, "trust.ttl");
  const legacy = { ...input, owner: "urn:example:legacy" };
  writeFileSync(json, JSON.stringify(legacy));
  expect(await readTrustFile(root)).toEqual(legacy);
  // New provisioning selects Turtle. Place the JSON back to exercise precedence.
  rmSync(json);
  await writeTrustFile(root, input);
  const bytes = readFileSync(turtle, "utf8");
  writeFileSync(json, JSON.stringify(legacy));
  expect(await readTrustFile(root)).toEqual(input);
  writeFileSync(turtle, bytes.replace(input.keys[0]!.kid, "x".repeat(43)));
  await expect(TrustStore.load(await readTrustFile(root))).rejects.toThrow(/match its JWK/);
  writeFileSync(turtle, "not turtle");
  await expect(readTrustFile(root)).rejects.toThrow(/malformed/);
  writeFileSync(
    turtle,
    bytes + "\n<urn:extra:store> a <https://w3id.org/jeswr/awp#TrustStore> .\n",
  );
  await expect(readTrustFile(root)).rejects.toThrow(/trust store/i);
});

it("refuses duplicate kids, conflicting roles and private fields in the Turtle path", async () => {
  root = mkdtempSync(join(tmpdir(), "awp-trust-test-"));
  const input = await trust();
  const [ownerKey, actorKey, ...keys] = input.keys;
  await writeTrustFile(root, { ...input, keys: [ownerKey!, ownerKey!, actorKey!, ...keys] });
  await expect(TrustStore.load(await readTrustFile(root))).rejects.toThrow(/pinned twice/);
  await writeTrustFile(root, {
    ...input,
    keys: [ownerKey!, { ...actorKey!, subject: owner }, ...keys],
  });
  await expect(TrustStore.load(await readTrustFile(root))).rejects.toThrow(/two roles/);

  await writeTrustFile(root, input);
  const turtle = join(root, "trust.ttl");
  const text = readFileSync(turtle, "utf8");
  const bytes = text.replace(/(a awp:JsonWebKey;)/, '$1\n    awp:d "private-material";');
  expect(bytes).not.toBe(text);
  writeFileSync(turtle, bytes);
  await expect(readTrustFile(root)).rejects.toThrow(/malformed/);
});
