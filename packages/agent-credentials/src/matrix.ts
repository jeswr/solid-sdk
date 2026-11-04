// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "fs";
import { dirname, isAbsolute } from "path";
import { z } from "zod";
import {
  type MatrixDeviceIdentity,
  matrixDeviceSchema,
  matrixIdentitySchema,
} from "./matrix-record.js";
import { type CredentialStore, HelperError } from "./store.js";

export type { MatrixDevice, MatrixDeviceIdentity } from "./matrix-record.js";

function privateDirectory(path: string): void {
  const st = lstatSync(path);
  if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0)
    throw new HelperError("refused", "Matrix directory must be private and owner-controlled");
}

/** Explicit import only. Never searches a registry, keychain or the default store. */
export function importMatrixDevice(options: {
  readonly store: CredentialStore;
  readonly file: string;
  readonly account: string;
  readonly purpose: "read" | "send";
  readonly expected: MatrixDeviceIdentity;
}): void {
  const expected = matrixIdentitySchema.safeParse(options.expected);
  if (!expected.success || !isAbsolute(options.file))
    throw new HelperError("invalid", "invalid Matrix device import configuration");
  privateDirectory(dirname(options.file));
  privateDirectory(expected.data.cryptoStorePath);
  let raw: unknown;
  try {
    const fd = openSync(
      options.file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = fstatSync(fd);
      if (
        !st.isFile() ||
        st.uid !== process.getuid?.() ||
        (st.mode & 0o077) !== 0 ||
        st.size > 65536
      )
        throw new Error();
      const text = readFileSync(fd, "utf8");
      if (Buffer.byteLength(text) > 65536) throw new Error();
      raw = JSON.parse(text);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new HelperError("refused", "Matrix device file is unreadable, unsafe or invalid");
  }
  // Registry provisioned device/login JSON. Store path is trusted operator configuration.
  const source = z
    .strictObject({
      homeserver: z.string(),
      user_id: z.string(),
      device_id: z.string(),
      access_token: z.string(),
    })
    .safeParse(raw);
  if (
    !source.success ||
    source.data.homeserver !== expected.data.homeserver ||
    source.data.user_id !== expected.data.userId ||
    source.data.device_id !== expected.data.deviceId
  )
    throw new HelperError(
      "account",
      "Matrix provisioned device does not match the pinned identity",
    );
  const record = matrixDeviceSchema.safeParse({
    ...expected.data,
    version: 1,
    account: options.account,
    purpose: options.purpose,
    accessToken: source.data.access_token,
  });
  if (!record.success) throw new HelperError("invalid", "invalid Matrix device record");
  options.store.putMatrixDevice(record.data);
}

/** Device/account/purpose pins are checked on every credential acquisition. */
export function createMatrixTokenProvider(options: {
  readonly store: CredentialStore;
  readonly account: string;
  readonly read: MatrixDeviceIdentity;
  readonly send?: MatrixDeviceIdentity;
}) {
  const { store, account } = options;
  const pins = {
    read: matrixIdentitySchema.parse(options.read),
    send: options.send === undefined ? undefined : matrixIdentitySchema.parse(options.send),
  };
  async function grant<P extends "read" | "send">(ref: { readonly id: string }, purpose: P) {
    const pin = pins[purpose];
    if (ref.id !== account || !pin)
      throw new HelperError("account", "Matrix account or purpose is not configured");
    const record = store.matrixDevice(account, purpose);
    if (!record) throw new HelperError("setup", "Matrix device requires explicit provisioning");
    if (
      record.homeserver !== pin.homeserver ||
      record.userId !== pin.userId ||
      record.deviceId !== pin.deviceId ||
      record.cryptoStorePath !== pin.cryptoStorePath
    )
      throw new HelperError("account", "Matrix stored device differs from pinned identity");
    return { access: purpose, accessToken: record.accessToken };
  }
  return {
    read: (ref: { readonly id: string }) => grant(ref, "read"),
    send: (ref: { readonly id: string }) => grant(ref, "send"),
  };
}
