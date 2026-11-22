// AUTHORED-BY Codex GPT-6

const ES256 = -7;
const RS256 = -257;
const EC = { name: "ECDSA", namedCurve: "P-256" };
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (char) => char.charCodeAt(0));
}

type CborKey = number | string;
type CborValue =
  | CborKey
  | boolean
  | null
  | Uint8Array<ArrayBuffer>
  | Map<CborKey, CborValue>
  | CborValue[];

/** Read the definite-length CBOR types used by attestation objects, COSE keys and extensions. */
class CborReader {
  offset: number;

  constructor(
    private readonly input: Uint8Array<ArrayBuffer>,
    offset = 0,
  ) {
    this.offset = offset;
  }

  private take(length: number): Uint8Array<ArrayBuffer> {
    if (length > this.input.length - this.offset) throw new Error("truncated CBOR data");
    const bytes = this.input.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  read(depth = 0): CborValue {
    if (depth > 8) throw new Error("CBOR nesting is too deep");
    const head = this.take(1)[0] as number;
    const kind = head >> 5;
    const argument = head & 31;
    let value = argument;
    if (argument >= 24) {
      if (argument > 26) throw new Error("unsupported CBOR size");
      const bytes = this.take(2 ** (argument - 24));
      value = 0;
      for (const byte of bytes) value = value * 256 + byte;
      const minimum = argument === 24 ? 24 : 256 ** (bytes.length / 2);
      if (value < minimum) throw new Error("non-minimal CBOR encoding");
    }
    switch (kind) {
      case 0:
        return value;
      case 1:
        return -1 - value;
      case 2:
        return this.take(value);
      case 3:
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(this.take(value));
      case 4: {
        const items: CborValue[] = [];
        for (let i = 0; i < value; i += 1) items.push(this.read(depth + 1));
        return items;
      }
      case 5: {
        const map = new Map<CborKey, CborValue>();
        for (let i = 0; i < value; i += 1) {
          const key = this.read(depth + 1);
          if (typeof key !== "string" && typeof key !== "number")
            throw new Error("invalid CBOR key");
          if (map.has(key)) throw new Error("duplicate CBOR key");
          map.set(key, this.read(depth + 1));
        }
        return map;
      }
      case 7:
        if (value === 20 || value === 21) return value === 21;
        if (value === 22) return null;
        break;
    }
    throw new Error("unsupported CBOR type");
  }
}

function readAttestationAuthData(attestationObject: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const reader = new CborReader(new Uint8Array(attestationObject));
  const object = reader.read();
  const authData = object instanceof Map && object.get("authData");
  if (!(authData instanceof Uint8Array) || reader.offset !== attestationObject.byteLength) {
    throw new Error("invalid attestation object");
  }
  return authData;
}

function readAttestedKey(
  response: AuthenticatorAttestationResponse,
  id: Uint8Array,
  registrationData: ArrayBuffer | undefined,
): Uint8Array<ArrayBuffer> {
  const data = registrationData
    ? new Uint8Array(registrationData)
    : readAttestationAuthData(response.attestationObject);
  // After the 37-byte header come the 16-byte AAGUID, ID length, ID, COSE key and extensions.
  const attested = 0x40;
  const extensions = 0x80;
  const flags = data[32] ?? 0;
  if (data.length < 55 || !(flags & attested)) throw new Error("no attested credential data");
  const idLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(53);
  const attestedId = data.subarray(55, 55 + idLength);
  if (idLength !== id.length || !id.every((byte, i) => byte === attestedId[i])) {
    throw new Error("attested credential ID mismatch");
  }
  const start = 55 + idLength;
  const reader = new CborReader(data, start);
  reader.read();
  const end = reader.offset;
  if (flags & extensions) {
    const outputs = reader.read();
    if (!(outputs instanceof Map) || [...outputs.keys()].some((key) => typeof key !== "string")) {
      throw new Error("invalid authenticator extensions");
    }
  }
  if (reader.offset !== data.length) throw new Error("unexpected attested data");
  return data.subarray(start, end);
}

function byteString(s: string): Uint8Array<ArrayBuffer> {
  const bytes = fromB64url(s);
  const length = bytes.length;
  const header =
    length < 24
      ? [0x40 + length]
      : length < 256
        ? [0x58, length]
        : [0x59, length >> 8, length & 255];
  const encoded = new Uint8Array(header.length + length);
  encoded.set(header);
  encoded.set(bytes, header.length);
  return encoded;
}

function encodeCoseKey(alg: number, jwk: JsonWebKey): Uint8Array<ArrayBuffer> {
  // Canonical COSE map entries start with kty (1) and alg (3), followed by key parameters.
  if (alg === ES256 && jwk.x && jwk.y) {
    return Uint8Array.of(
      0xa5,
      1,
      2,
      3,
      0x26,
      0x20,
      1,
      0x21,
      ...byteString(jwk.x),
      0x22,
      ...byteString(jwk.y),
    );
  }
  if (alg === RS256 && jwk.n && jwk.e) {
    return Uint8Array.of(
      0xa4,
      1,
      3,
      3,
      0x39,
      1,
      0,
      0x20,
      ...byteString(jwk.n),
      0x21,
      ...byteString(jwk.e),
    );
  }
  throw new Error("unsupported credential public key");
}

export async function importCoseKey(
  subtle: SubtleCrypto,
  cose: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const reader = new CborReader(cose);
  const key = reader.read();
  if (!(key instanceof Map) || reader.offset !== cose.length) throw new Error("invalid COSE key");
  const alg = key.get(3);
  const kty = key.get(1);
  const first = key.get(-1);
  const second = key.get(-2);
  const third = key.get(-3);
  if (
    alg === ES256 &&
    kty === 2 &&
    first === 1 &&
    key.size === 5 &&
    second instanceof Uint8Array &&
    second.length === 32 &&
    third instanceof Uint8Array &&
    third.length === 32
  ) {
    const jwk = { kty: "EC", crv: "P-256", x: b64url(second), y: b64url(third) };
    return subtle.importKey("jwk", jwk, EC, false, ["verify"]);
  }
  if (
    alg === RS256 &&
    kty === 3 &&
    key.size === 4 &&
    first instanceof Uint8Array &&
    first.length > 0 &&
    second instanceof Uint8Array &&
    second.length > 0
  ) {
    const jwk = { kty: "RSA", n: b64url(first), e: b64url(second) };
    const imported = await subtle.importKey("jwk", jwk, RSA, false, ["verify"]);
    checkRsaKey(imported, first);
    return imported;
  }
  throw new Error("unsupported credential public key");
}

function unsignedInteger(bytes: Uint8Array): bigint {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x0${hex}`);
}

function checkRsaKey(key: CryptoKey, modulus: Uint8Array): void {
  const { modulusLength, publicExponent } = key.algorithm as RsaHashedKeyAlgorithm;
  if (!Number.isInteger(modulusLength) || modulusLength < 2048) {
    throw new Error("RSA credential modulus must be at least 2048 bits");
  }
  // PKCS #1 requires 3 <= e < n and coprimality with the even lambda(n).
  const exponent = unsignedInteger(publicExponent);
  if (exponent < 3n || exponent % 2n === 0n || exponent >= unsignedInteger(modulus)) {
    throw new Error("invalid RSA credential exponent");
  }
}

export async function registrationKey(
  subtle: SubtleCrypto,
  response: AuthenticatorAttestationResponse,
  id: Uint8Array,
  authData: ArrayBuffer | undefined,
): Promise<{ key: CryptoKey; cose: Uint8Array<ArrayBuffer> }> {
  const spki = response.getPublicKey?.();
  const alg = response.getPublicKeyAlgorithm?.();
  if (spki && alg !== undefined) {
    const algorithm = alg === ES256 ? EC : alg === RS256 ? RSA : undefined;
    if (!algorithm) throw new Error("unsupported credential algorithm");
    const key = await subtle.importKey("spki", spki, algorithm, true, ["verify"]);
    const jwk = await subtle.exportKey("jwk", key);
    if (alg === RS256 && jwk.n) checkRsaKey(key, fromB64url(jwk.n));
    const cose = encodeCoseKey(alg, jwk);
    return { key, cose };
  }
  const cose = readAttestedKey(response, id, authData);
  return { key: await importCoseKey(subtle, cose), cose };
}

/** ES256 WebAuthn signatures are DER. Web Crypto expects the two 32-byte integers. */
function rawEs256Signature(der: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) {
    return null;
  }
  const raw = new Uint8Array(64);
  let offset = 2;
  for (const end of [32, 64]) {
    const length = der[offset + 1] ?? 0;
    if (der[offset] !== 0x02 || length < 1 || length > 33 || offset + 2 + length > der.length) {
      return null;
    }
    const integer = der.subarray(offset + 2, offset + 2 + length);
    const first = integer[0] as number;
    if (first >= 0x80) return null;
    const padded = length > 1 && first === 0;
    if (padded && (integer[1] as number) < 0x80) return null;
    const magnitude = padded ? integer.subarray(1) : integer;
    if (magnitude.length > 32) return null;
    raw.set(magnitude, end - magnitude.length);
    offset += 2 + length;
  }
  return offset === der.length ? raw : null;
}

export async function verifyAssertionSignature(
  subtle: SubtleCrypto,
  key: CryptoKey,
  response: AuthenticatorAssertionResponse,
): Promise<boolean> {
  const signature = new Uint8Array(response.signature);
  const ecdsa = key.algorithm.name === EC.name;
  const verificationSignature = ecdsa ? rawEs256Signature(signature) : signature;
  if (!verificationSignature) return false;
  const clientHash = new Uint8Array(await subtle.digest("SHA-256", response.clientDataJSON));
  const data = new Uint8Array(response.authenticatorData.byteLength + clientHash.length);
  data.set(new Uint8Array(response.authenticatorData));
  data.set(clientHash, response.authenticatorData.byteLength);
  const algorithm = ecdsa ? { name: EC.name, hash: "SHA-256" } : RSA.name;
  return subtle.verify(algorithm, key, verificationSignature, data);
}
