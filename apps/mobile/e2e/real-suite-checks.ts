// AUTHORED-BY Codex GPT-6
/** Evidence contains public observations only, never protocol messages or credentials. */
export interface LoginEvidence {
  customTab: boolean;
  passwordSubmitted: boolean;
  consentSubmitted: boolean;
  schemeCallback: boolean;
  signedInAccount: boolean;
}

export function checkPrivateRead(
  login: LoginEvidence,
  anonymousStatus: number,
  body: unknown,
  expected: string,
): string[] {
  const keys: (keyof LoginEvidence)[] = [
    "customTab",
    "passwordSubmitted",
    "consentSubmitted",
    "schemeCallback",
    "signedInAccount",
  ];
  const failures = keys
    .filter((key) => login[key] !== true)
    .map((key) => `Missing native login evidence: ${key}`);
  if (![401, 403].includes(anonymousStatus)) failures.push("Resource was not private");
  if (typeof body !== "string" || body !== expected)
    failures.push("Authenticated preview body did not match exactly");
  return failures;
}

export function sendIntent(text: string | undefined, stream?: string): string[] {
  if (stream && !/^content:\/\/media\/external\/file\/\d+$/.test(stream))
    throw new Error("Expected an external MediaStore content URI");
  if (text === undefined && !stream) throw new Error("Share needs an item");
  return [
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.SEND",
    "-t",
    stream ? "application/pdf" : "text/plain",
    ...(stream
      ? ["--grant-read-uri-permission", "--eu", "android.intent.extra.STREAM", stream]
      : []),
    ...(text === undefined ? [] : ["--es", "android.intent.extra.TEXT", text]),
    "-n",
    "org.jeswr.suite/.ShareReceiverActivity",
  ];
}

export interface ShareObservation {
  path: string;
  heading: string | null;
  sessionReady: boolean;
  items: string[];
}

export function checkShare(observed: ShareObservation, expected: string): string[] {
  const failures: string[] = [];
  if (!/^\/share\/?$/.test(observed.path) || observed.heading !== "Save to Suite")
    failures.push("Share screen was not reached");
  if (!observed.sessionReady) failures.push("Signed-in share session was not ready");
  if (observed.items.length !== 1 || observed.items[0] !== expected)
    failures.push("Shared item did not match exactly");
  return failures;
}

/** Android activity diagnostics may contain callback URLs. Drop whole sensitive lines. */
export function redactLogcat(input: string, secrets: readonly string[] = []): string {
  return input
    .split(/\r?\n/)
    .map((line) =>
      /(?:https?:\/\/|org\.jeswr\.suite:\/|authorization|dpop|token|password|secret|cookie|code=|state=|@example\.com|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|eyJ[a-zA-Z0-9_-]*\.)/i.test(
        line,
      ) || secrets.some((secret) => secret.length > 0 && line.includes(secret))
        ? "[redacted sensitive log line]"
        : line,
    )
    .join("\n");
}

export function reportStatus(steps: readonly { status: string }[]): "passed" | "failed" {
  return steps.length === 7 && steps.every((step) => step.status === "passed")
    ? "passed"
    : "failed";
}
