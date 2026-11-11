// AUTHORED-BY Codex GPT-6.1-Sol
/** The HTTP exception is limited to development on a loopback host. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    (/^127(?:\.\d{1,3}){3}$/u.test(hostname) &&
      hostname.split(".").every((part) => Number(part) <= 255))
  );
}

export function allowInsecureLoopback(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    typeof location !== "undefined" &&
    isLoopbackHost(location.hostname)
  );
}
