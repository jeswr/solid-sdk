// AUTHORED-BY Codex GPT-6.1-Sol
import { checkGatedUnwrap, type GatedUnwrapVerdict } from "./checks.ts";

interface AndroidProbe {
  shell: (...args: string[]) => Promise<string>;
  finger: () => Promise<unknown>;
  ui: () => Promise<string>;
  evaluate: (expression: string) => Promise<unknown>;
  pause: () => Promise<unknown>;
}
const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

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
  let authenticationSent = false;
  const snapshot = () => io.evaluate("window.__e2eSecureStore.gated()");
  const skipped = (reason: string, evidence: unknown): GatedUnwrapVerdict => ({
    status: "not automatable",
    reason,
    promptObserved,
    authenticationSent,
    evidence,
  });
  const failed = (reason: string, evidence: unknown): GatedUnwrapVerdict => ({
    status: "failed",
    reason,
    promptObserved,
    authenticationSent,
    evidence,
  });
  const unautomatable = async (reason: string) => {
    const evidence = await snapshot();
    return row(evidence).stage === "waiting"
      ? skipped(reason, evidence)
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
          await io.finger();
          authenticationSent = true;
          break;
        }
      } else {
        const pin = uiTarget(xml, /pinEntry|password_entry|passwordEntry|EditText/);
        if (pin && /(?:com\.android\.systemui|com\.android\.settings)/.test(xml)) {
          promptObserved = true;
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
        if (credential) await io.shell("input", "tap", ...credential);
      }
      await io.pause();
    }
  } catch (error) {
    return unautomatable(`system prompt automation: ${String(error)}`);
  }
  if (!authenticationSent)
    return unautomatable(`${path} system prompt/control could not be identified`);
  for (let attempt = 0; attempt < 40; attempt++) {
    evidence = await snapshot();
    if (row(evidence).stage === "error")
      return failed("Native gated get rejected after authentication", evidence);
    if (row(evidence).stage === "done") {
      const verdict: GatedUnwrapVerdict = {
        status: "passed",
        promptObserved,
        authenticationSent,
        evidence,
      };
      return checkGatedUnwrap(verdict).length
        ? failed("Gated value/version mismatch", evidence)
        : verdict;
    }
    await io.pause();
  }
  return unautomatable(
    `${path} input sent but the system did not complete authentication within the observation window`,
  );
}
