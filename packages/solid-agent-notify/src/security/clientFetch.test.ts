// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { clientFetch } from "./clientFetch.js";

afterEach(() => vi.unstubAllGlobals());

test.each([
  undefined,
  null,
  {},
])("recognizes a browser only with window === globalThis and a document (%j)", async (document) => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", document);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
  await expect(clientFetch({ fetch })("https://8.8.8.8/profile")).resolves.toHaveProperty(
    "status",
    200,
  );
  expect(fetch).toHaveBeenCalledOnce();
});

test("refuses final responses redirected by a transport that ignored manual mode", async () => {
  for (const finalUrl of [
    "https://1.1.1.1/collect",
    "https://127.0.0.1/collect",
    "https://8.8.8.8/other",
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      const response = new Response(finalUrl.includes("127.0.0.1") ? null : "body", {
        status: finalUrl.includes("127.0.0.1") ? 204 : 200,
      });
      Object.defineProperty(response, "url", { value: finalUrl });
      return response;
    });
    await expect(clientFetch({ fetch })("https://8.8.8.8/path")).rejects.toThrow("redirect");
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  }
});

// Retain Pod Manager's complete former rejection matrix at the shared boundary.
test.each([
  "https://localhost/inbox/",
  "https://localhost:3000/inbox/",
  "https://foo.localhost/inbox/",
  "https://printer.local/inbox/",
  "https://127.0.0.1/inbox/",
  "https://127.5.5.5/inbox/",
  "https://10.0.0.1/inbox/",
  "https://10.255.255.255/inbox/",
  "https://172.16.0.1/inbox/",
  "https://172.31.255.255/inbox/",
  "https://192.168.1.1/inbox/",
  "https://169.254.0.1/inbox/",
  "https://169.254.169.254/latest/meta-data/", // cloud metadata
  "https://0.0.0.0/inbox/",
  "https://[::1]/inbox/",
  "https://[::]/inbox/",
  "https://[fc00::1]/inbox/", // unique-local
  "https://[fd12:3456::1]/inbox/", // fd.. is within fc00::/7
  "https://[fe80::1]/inbox/", // link-local
  "https://[::ffff:127.0.0.1]/inbox/", // IPv4-mapped loopback
  "https://[::ffff:192.168.0.1]/inbox/", // IPv4-mapped private
  // Trailing-dot (FQDN) blocklist-bypass variants — must still be blocked.
  "https://localhost./inbox/",
  "https://localhost.:3000/inbox/",
  "https://printer.local./inbox/",
  // Additional reserved IPv4 ranges (fail-closed gate denies all reserved).
  "https://100.64.0.1/inbox/", // CGNAT 100.64.0.0/10
  "https://100.127.255.255/inbox/",
  "https://192.0.0.1/inbox/", // 192.0.0.0/24
  "https://198.18.0.1/inbox/", // 198.18.0.0/15 benchmarking
  "https://198.19.255.255/inbox/",
  "https://255.255.255.255/inbox/", // broadcast
  "https://[fec0::1]/inbox/", // deprecated site-local
  "https://[64:ff9b::7f00:1]/inbox/", // NAT64 embedding 127.0.0.1
  "https://[2002:7f00:1::1]/inbox/", // 6to4 embedding 127.0.0.1
  // Multicast / reserved (224.0.0.0/4, 240.0.0.0/4).
  "https://224.0.0.1/inbox/",
  "https://240.0.0.1/inbox/",
  // Encoded-loopback forms — `new URL()` canonicalises these to 127.0.0.1, so
  // they must be blocked. This regression-locks the canonicalisation
  // assumption that the IPv4 string parser relies on (a load-bearing SSRF
  // defence: if a runtime parsed hosts differently this would silently open).
  "https://2130706433/inbox/", // integer form of 127.0.0.1
  "https://0x7f.0.0.1/inbox/", // hex first octet
  "https://0177.0.0.1/inbox/", // octal first octet
  "https://0x7f000001/inbox/", // hex integer form
  // Known cloud-metadata hostnames (resolve to 169.254.169.254).
  "https://metadata.google.internal/computeMetadata/",
  "https://metadata.google.internal./computeMetadata/", // trailing dot
  // Dotless / single-label hosts resolve to intranet via search domains.
  "https://wiki/inbox/",
  "https://router/inbox/",
  "https://intranet:8080/inbox/",
])("refuses Pod Manager's former blocked targets before authenticated I/O: %s", async (url) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(clientFetch({ fetch })(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("accepts Request inputs while preserving method, headers and final URL checks", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("body"));
  const request = new Request("https://8.8.8.8/path", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  await expect(clientFetch({ fetch })(request)).resolves.toHaveProperty("status", 200);
  expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("text/plain");
});
