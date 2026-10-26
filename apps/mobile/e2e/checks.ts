// AUTHORED-BY GPT-5.6 Codex
/** Pure assertions shared by the Node 24 driver and Vitest. Missing evidence always fails. */
export const CAPABILITIES = ["secureContext", "cryptoSubtle", "locks", "serviceWorker"] as const;
export const FRAME_PROBES = [
  "androidBridge",
  "CapacitorCookiesAndroidInterface",
  "CapacitorHttpAndroidInterface",
  "capacitorPlugin",
  "webMessage",
] as const;
export const IOS_FRAME_PROBES = ["webkitBridge", "prompt"] as const;
export const IOS_OBSERVATION_MS = 2000;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Select only this app process's socket; never attach to Chrome or a stale WebView. */
export function parseDevtoolsSockets(unix: string, pid: string): string[] {
  if (!/^[1-9]\d*$/.test(pid)) throw new Error("Expected one positive app PID");
  const expected = `webview_devtools_remote_${pid}`;
  return [
    ...new Set(
      unix.split(/\r?\n/).flatMap((line) => {
        const path = line.trim().split(/\s+/).at(-1);
        return path === `@${expected}` ? [expected] : [];
      }),
    ),
  ];
}

export function checkFixture(
  value: unknown,
  suiteOrigin: string,
  foreignOrigin: string,
  platform: "android" | "ios" = "android",
): string[] {
  const result = record(value);
  const failures: string[] = [];
  if (result.done !== true || result.page !== "index") failures.push("Fixture did not finish");
  if (result.origin !== suiteOrigin) failures.push("Top frame left the suite origin");
  const capabilities = record(result.capabilities);
  for (const key of CAPABILITIES) {
    if (capabilities[key] !== true) failures.push(`Missing capability: ${key}`);
  }
  if (result.topBridge !== true) failures.push("Top-frame SuiteShareIntake.getPending failed");
  // iOS addListener returns a JS handle without acknowledging native registration.
  if (platform === "android" && result.listenerReady !== true)
    failures.push("Share listener was not registered");
  if (!Array.isArray(result.errors) || result.errors.length)
    failures.push("Fixture reported errors");
  const hostile = record(result.hostile);
  if (hostile.origin !== foreignOrigin || foreignOrigin === suiteOrigin) {
    failures.push("Missing cross-origin hostile frame evidence");
  }
  const attempts = record(hostile.attempts);
  if (platform === "ios") {
    if (result.platform !== "ios") failures.push("Missing iOS platform evidence");
    const ios = record(result.ios);
    const controls = record(ios.top);
    const responses = ios.responses;
    if (!Array.isArray(responses)) failures.push("Missing iOS native response history");
    for (const key of IOS_FRAME_PROBES) {
      const control = record(controls[key]);
      const attempt = record(attempts[key]);
      const controlWorks =
        key === "webkitBridge"
          ? control.status === "resolved" && Array.isArray(record(control.data).batches)
          : control.status === "response" &&
            typeof control.value === "string" &&
            ["true", "false"].includes(control.value);
      // Silence is meaningful only if the identical native operation works in the main frame.
      if (result.topBridge !== true || !controlWorks) {
        failures.push(`iOS iframe isolation is vacuous: ${key} top-frame control failed`);
      }
      const callbackValid =
        key !== "webkitBridge" ||
        (typeof attempt.callbackId === "string" &&
          attempt.callbackId.startsWith("mob07-hostile-") &&
          attempt.callbackId !== control.callbackId &&
          typeof control.callbackId === "string" &&
          !responsesAsRecords(responses).some((reply) => reply.callbackId === attempt.callbackId));
      if (
        attempt.status !== "no-response" ||
        (key === "prompt" && attempt.value !== null) ||
        typeof attempt.observedMs !== "number" ||
        !Number.isFinite(attempt.observedMs) ||
        attempt.observedMs < IOS_OBSERVATION_MS ||
        !callbackValid
      ) {
        failures.push(`Hostile frame native effect accessible or unproven: ${key}`);
      }
    }
    return failures;
  }
  const noTransport = FRAME_PROBES.filter((probe) => probe !== "capacitorPlugin").every(
    (probe) => record(attempts[probe]).status === "unavailable",
  );
  for (const key of FRAME_PROBES) {
    const attempt = record(attempts[key]);
    const status = attempt.status;
    // A generated plugin wrapper can exist in an isolated document but has no transport. A
    // timeout or known missing-plugin rejection is evidence only with ALL native surfaces absent.
    const knownRejection =
      status === "rejected" &&
      attempt.code === "UNIMPLEMENTED" &&
      typeof attempt.message === "string" &&
      /^"SuiteShareIntake(?:" plugin|\.getPending\(\)") is not implemented on (?:web|android)$/.test(
        attempt.message,
      );
    if (
      status !== "unavailable" &&
      !(key === "capacitorPlugin" && noTransport && (status === "no-response" || knownRejection))
    ) {
      failures.push(`Hostile frame native surface accessible or unproven: ${key}`);
    }
  }
  return failures;
}

const responsesAsRecords = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);

export function checkTextShare(value: unknown, text: string): string[] {
  if (!Array.isArray(value) || value.length !== 1)
    return ["Expected exactly one pending share batch"];
  const batch = record(value[0]);
  const items = batch.items;
  if (
    typeof batch.id !== "string" ||
    !batch.id ||
    !Array.isArray(items) ||
    items.length !== 1 ||
    record(items[0]).kind !== "text" ||
    record(items[0]).text !== text
  ) {
    return ["Share did not contain exactly the sent text"];
  }
  return [];
}

export function checkTextShareDelivery(
  pending: unknown,
  events: unknown,
  text: string,
  beforeDocument: unknown,
  afterDocument: unknown,
): string[] {
  const failures = checkTextShare(pending, text);
  if (
    typeof beforeDocument !== "string" ||
    !beforeDocument ||
    typeof afterDocument !== "string" ||
    !afterDocument
  ) {
    failures.push("Missing share document identity");
  }
  if (!Array.isArray(events)) {
    failures.push("Missing shareReceived evidence");
  } else if (beforeDocument === afterDocument || events.length > 0) {
    if (checkTextShare(events, text).length) {
      failures.push("Expected exactly one matching shareReceived event");
    } else if (record(events[0]).id !== record(Array.isArray(pending) ? pending[0] : null).id) {
      failures.push("shareReceived did not match the pending batch id");
    }
  }
  return failures;
}

export function checkRejectedShare(pending: unknown, events: unknown): string[] {
  return Array.isArray(pending) &&
    pending.length === 0 &&
    Array.isArray(events) &&
    events.length === 0
    ? []
    : ["Rejected file:// share reached the inbox or listener (or evidence is missing)"];
}

export function checkNavigation(value: unknown, suiteOrigin: string, target: string): string[] {
  const result = record(value);
  const navigation = record(result.navigation);
  return result.done === true &&
    result.page === "navigation" &&
    result.origin === suiteOrigin &&
    navigation.attempted === true &&
    navigation.refused === true &&
    navigation.target === target
    ? []
    : ["Foreign top-frame navigation was allowed or refusal was not proven"];
}

/** XCUITest reads the document before tapping, after refusal, and after foregrounding again. */
export function checkIOSNavigation(value: unknown, suiteOrigin: string, target: string): string[] {
  const evidence = record(value);
  const before = record(evidence.before);
  const failures: string[] = [];
  if (
    before.page !== "navigation" ||
    before.origin !== suiteOrigin ||
    before.done !== false ||
    record(before.navigation).attempted !== false ||
    typeof before.documentId !== "string" ||
    !before.documentId ||
    before.href !== `${suiteOrigin}/navigation.html?manual=1`
  ) {
    failures.push("Missing pre-navigation document identity");
  }
  for (const key of ["after", "reactivated"]) {
    const current = record(evidence[key]);
    failures.push(...checkNavigation(current, suiteOrigin, target));
    if (current.documentId !== before.documentId || current.href !== before.href) {
      failures.push(`Navigation document did not survive: ${key}`);
    }
  }
  return failures;
}

/** adb shell joins its arguments into shell source, even when execFile is used on the host. */
export function quoteAndroidShell(value: string): string {
  if (value.includes("\0")) throw new Error("NUL is not a shell argument");
  return `'${value.replaceAll("'", "'\\''")}'`;
}
