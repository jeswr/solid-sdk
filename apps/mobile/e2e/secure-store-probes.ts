// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  checkGatedUnwrap,
  checkSecureStoreStatus,
  type GATED_NOT_AUTOMATABLE_REASONS,
  type GatedUnwrapVerdict,
} from "./checks.ts";

interface AndroidProbe {
  shell: (...args: string[]) => Promise<string>;
  finger: () => Promise<unknown>;
  ui: () => Promise<string>;
  evaluate: (expression: string) => Promise<unknown>;
  pause: () => Promise<unknown>;
}
const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const noCredential =
  /^(?:Old password provided but user has no password|No (?:lock )?credential(?: set| configured)?[.!]?)$/i;

/** get-disabled alone cannot distinguish an unsecured swipe lock from a credential. */
export async function assertUnsecuredEmulator(shell: AndroidProbe["shell"]): Promise<void> {
  const disabled = await shell("locksettings", "get-disabled");
  if (!/^(?:true|false)$/.test(disabled))
    throw new Error(`Cannot inspect emulator lock state: ${disabled}`);
  const verified = await shell("locksettings", "verify");
  if (!/^Lock credential verified successfully$/.test(verified))
    throw new Error(`Emulator must start without a lock credential: ${verified}`);
}

export async function clearEmulatorPin(shell: AndroidProbe["shell"]): Promise<void> {
  let cleared: string;
  try {
    cleared = await shell("locksettings", "clear", "--old", "1234");
  } catch (error) {
    // execFile puts a nonzero command's stdout on the error, not in its message.
    const output = [row(error).stdout, row(error).stderr, row(error).message].find(
      (part) => typeof part === "string" && part.trim(),
    );
    cleared = typeof output === "string" ? output.trim() : String(error);
    const stderr = row(error).stderr;
    if (
      !noCredential.test(cleared) ||
      (typeof stderr === "string" && stderr.trim() && !noCredential.test(stderr.trim()))
    )
      throw error;
  }
  if (!/^Lock credential cleared$/i.test(cleared.trim()) && !noCredential.test(cleared.trim()))
    throw new Error(`PIN cleanup did not confirm success: ${cleared}`);
  // Reconcile even an already-absent credential; an ambiguous/failed clear must not pass.
  await assertUnsecuredEmulator(shell);
}

/** The harness proves capability; the plugin cannot opt itself out of these tests. */
export function gatedUnwrapPreflight(
  path: "fingerprint" | "credential",
  runner: { pinVerified: boolean; fingerprintEnrolled: boolean },
  status: unknown,
): GatedUnwrapVerdict | undefined {
  const evidence = { runner, status };
  if (checkSecureStoreStatus(status).length)
    return { status: "failed", reason: "Invalid native secure-store status", evidence };
  if (!runner.pinVerified)
    return { status: "not automatable", reason: "PIN setup failed", evidence };
  if (row(status).userPresence !== true)
    return {
      status: "failed",
      reason: "Native user presence unavailable despite verified runner PIN",
      evidence,
    };
  if (path === "fingerprint" && !runner.fingerprintEnrolled)
    return { status: "not automatable", reason: "fingerprint enrollment failed", evidence };
  return undefined;
}

/** Only tap visible system controls with a matching label/id and concrete screen bounds. */
export function uiTarget(xml: string, match: RegExp): [string, string] | undefined {
  for (const node of xml.matchAll(/<node\b[^>]*>/g)) {
    const attributes = Object.fromEntries(
      [...node[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    if (
      attributes.enabled === "false" ||
      !match.test(
        `${attributes.text ?? ""}|${attributes["resource-id"] ?? ""}|${attributes["content-desc"] ?? ""}|${attributes.class ?? ""}`,
      )
    )
      continue;
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attributes.bounds ?? "");
    if (bounds && Number(bounds[3]) > Number(bounds[1]) && Number(bounds[4]) > Number(bounds[2]))
      return [
        String(Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2)),
        String(Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2)),
      ];
  }
  return undefined;
}

export function fingerprintEnrolled(dump: string): boolean {
  // FingerprintService's JSON prints array (legacy HAL) or per-user sensor dump (AIDL HAL).
  return (
    /"prints"\s*:\s*\[\s*\{\s*"id"\s*:\s*0\s*,\s*"count"\s*:\s*[1-9]\d*/.test(dump) ||
    /User:\s*0\s*,[^\n]*\bbiometrics:\s*[1-9]\d*/i.test(dump)
  );
}

export async function enrollFingerprint(io: AndroidProbe): Promise<string> {
  try {
    if (fingerprintEnrolled(await io.shell("dumpsys", "fingerprint"))) return "enrolled";
    await io.shell("am", "start", "-W", "-a", "android.settings.FINGERPRINT_ENROLL");
    for (let attempt = 0; attempt < 16; attempt++) {
      if (fingerprintEnrolled(await io.shell("dumpsys", "fingerprint"))) return "enrolled";
      const xml = await io.ui();
      const pin = uiTarget(xml, /pinEntry|password_entry|passwordEntry|EditText/);
      if (pin) {
        await io.shell("input", "tap", ...pin);
        await io.shell("input", "text", "1234");
        await io.shell("input", "keyevent", "66");
      } else {
        const next = uiTarget(xml, /^(?:Next|Continue|I agree|More|Got it|Done)\|/i);
        if (next) await io.shell("input", "tap", ...next);
        await io.finger();
      }
      await io.pause();
    }
    return "not automatable on this runner: fingerprint enrollment could not be confirmed by dumpsys fingerprint";
  } catch (error) {
    return `not automatable on this runner: fingerprint enrollment: ${String(error)}`;
  }
}

export async function attemptGatedUnwrap(
  path: "fingerprint" | "credential",
  io: AndroidProbe,
): Promise<GatedUnwrapVerdict> {
  let promptObserved = false;
  let authenticationAttempted = false;
  let authenticationSent = false;
  let authenticationConfirmed = false;
  let promptAfterInput: string | undefined;
  const snapshot = () => io.evaluate("window.__e2eSecureStore.gated()");
  const skipped = (
    reason: (typeof GATED_NOT_AUTOMATABLE_REASONS)[number],
    evidence: unknown,
  ): GatedUnwrapVerdict => ({
    status: "not automatable",
    reason,
    promptObserved,
    authenticationAttempted,
    authenticationSent,
    authenticationConfirmed,
    evidence,
  });
  const failed = (reason: string, evidence: unknown): GatedUnwrapVerdict => ({
    status: "failed",
    reason,
    promptObserved,
    authenticationAttempted,
    authenticationSent,
    authenticationConfirmed,
    evidence: { ...row(evidence), ...(promptAfterInput === undefined ? {} : { promptAfterInput }) },
  });
  const unautomatable = async (
    reason: (typeof GATED_NOT_AUTOMATABLE_REASONS)[number],
    error?: unknown,
  ) => {
    const evidence = await snapshot();
    if (authenticationAttempted)
      return failed(
        `System authentication automation failed after input attempt: ${String(error)}`,
        evidence,
      );
    return row(evidence).stage === "waiting"
      ? skipped(reason, {
          ...row(evidence),
          ...(error === undefined ? {} : { automationError: String(error) }),
        })
      : failed("Native get settled while system authentication could not be automated", evidence);
  };
  // Bridge errors and early unwraps are product failures, never runner skips.
  await io.evaluate(`window.__e2eSecureStore.startGated(${JSON.stringify(path)})`);
  let evidence = await snapshot();
  for (let attempt = 0; row(evidence).stage === "preparing" && attempt < 40; attempt++) {
    await io.pause();
    evidence = await snapshot();
  }
  if (row(evidence).stage !== "waiting")
    return failed("Gated preparation failed or unwrap completed without authentication", evidence);
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const xml = await io.ui();
      evidence = await snapshot();
      if (row(evidence).stage !== "waiting")
        return failed("Unwrap settled before authentication input", evidence);
      if (path === "fingerprint") {
        if (/Unlock Solid Suite/.test(xml)) {
          promptObserved = true;
          authenticationAttempted = true;
          await io.finger();
          authenticationSent = true;
          break;
        }
      } else {
        const pin = uiTarget(xml, /pinEntry|password_entry|passwordEntry|EditText/);
        if (pin && /(?:com\.android\.systemui|com\.android\.settings)/.test(xml)) {
          promptObserved = true;
          authenticationAttempted = true;
          await io.shell("input", "tap", ...pin);
          await io.shell("input", "text", "1234");
          await io.shell("input", "keyevent", "66");
          authenticationSent = true;
          break;
        }
        const credential = uiTarget(
          xml,
          /^(?:Use PIN|Use screen lock|Use device credential|PIN)\|/i,
        );
        if (/Unlock Solid Suite/.test(xml) || credential) promptObserved = true;
        if (credential) await io.shell("input", "tap", ...credential);
      }
      await io.pause();
    }
  } catch (error) {
    return unautomatable("system prompt controls unavailable before authentication", error);
  }
  if (!authenticationSent)
    return unautomatable(
      promptObserved
        ? "system prompt controls unavailable before authentication"
        : "system prompt never appeared",
    );
  for (let attempt = 0; attempt < 40; attempt++) {
    evidence = await snapshot();
    if (row(evidence).stage === "error")
      return failed("Native gated get rejected after authentication", evidence);
    if (row(evidence).stage === "done") {
      const verdict: GatedUnwrapVerdict = {
        status: "passed",
        promptObserved,
        authenticationAttempted,
        authenticationSent,
        authenticationConfirmed,
        evidence,
      };
      return checkGatedUnwrap(verdict).length
        ? failed("Gated value/version mismatch", evidence)
        : verdict;
    }
    if (!authenticationConfirmed) {
      try {
        promptAfterInput = await io.ui();
        authenticationConfirmed =
          /<node\b[^>]*\bpackage="org\.jeswr\.suite"/.test(promptAfterInput) &&
          !/Unlock Solid Suite/.test(promptAfterInput) &&
          !/pinEntry|password_entry|passwordEntry/.test(promptAfterInput);
      } catch (error) {
        return failed(
          `Cannot confirm system authentication after input: ${String(error)}`,
          evidence,
        );
      }
    }
    await io.pause();
  }
  return failed(
    authenticationConfirmed
      ? "native callback never resolved after confirmed authentication"
      : "System authentication did not dismiss after input within the observation window",
    evidence,
  );
}
