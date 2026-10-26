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

export function checkFixture(value: unknown, suiteOrigin: string, foreignOrigin: string): string[] {
  const result = record(value);
  const failures: string[] = [];
  if (result.done !== true || result.page !== "index") failures.push("Fixture did not finish");
  if (result.origin !== suiteOrigin) failures.push("Top frame left the suite origin");
  const capabilities = record(result.capabilities);
  for (const key of CAPABILITIES) {
    if (capabilities[key] !== true) failures.push(`Missing capability: ${key}`);
  }
  if (result.topBridge !== true) failures.push("Top-frame SuiteShareIntake.getPending failed");
  if (result.listenerReady !== true) failures.push("Share listener was not registered");
  if (!Array.isArray(result.errors) || result.errors.length)
    failures.push("Fixture reported errors");
  const hostile = record(result.hostile);
  if (hostile.origin !== foreignOrigin || foreignOrigin === suiteOrigin) {
    failures.push("Missing cross-origin hostile frame evidence");
  }
  const attempts = record(hostile.attempts);
  for (const key of FRAME_PROBES) {
    const status = record(attempts[key]).status;
    // A generated plugin wrapper can exist in an isolated document but has no transport. A
    // timeout alone proves nothing: permit it only when ALL native surfaces are unavailable.
    const noTransport = FRAME_PROBES.filter((probe) => probe !== "capacitorPlugin").every(
      (probe) => record(attempts[probe]).status === "unavailable",
    );
    if (
      status !== "unavailable" &&
      status !== "rejected" &&
      !(key === "capacitorPlugin" && status === "no-response" && noTransport)
    ) {
      failures.push(`Hostile frame native surface accessible or unproven: ${key}`);
    }
  }
  return failures;
}

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

/** adb shell joins its arguments into shell source, even when execFile is used on the host. */
export function quoteAndroidShell(value: string): string {
  if (value.includes("\0")) throw new Error("NUL is not a shell argument");
  return `'${value.replaceAll("'", "'\\''")}'`;
}
