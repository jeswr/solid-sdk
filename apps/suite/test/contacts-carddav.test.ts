// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { readCardDav } from "../src/apps/contacts/lib/carddav";

const vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Mira\r\nEND:VCARD\r\n";
describe("browser CardDAV through solid-dav-bridge", () => {
  it("issues a bounded REPORT with in-memory Basic auth and no cookies, cache, referrer or redirects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(vcard));
    expect(await readCardDav("https://dav.example.org/book/", "mira", "secret", fetch)).toBe(vcard);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://dav.example.org/book/");
    expect(init).toMatchObject({
      method: "REPORT",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(init.headers).toMatchObject({
      authorization: `Basic ${btoa("mira:secret")}`,
      depth: "1",
    });
    expect(init.body).toContain("addressbook-query");
    expect(init.body).toContain('<c:filter><c:prop-filter name="FN"/></c:filter>');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("extracts namespaced address data with entities and CDATA from multi-status responses", async () => {
    const text =
      '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:response>outside<c:address-data>BEGIN:VCARD\nFN:Mira &amp; Co\nEND:VCARD</c:address-data><c:address-data><![CDATA[BEGIN:VCARD\nFN:Two\nEND:VCARD]]></c:address-data><![CDATA[ignored]]></d:response></d:multistatus>';
    expect(
      await readCardDav("http://localhost:8888/book/", "", "", async () => new Response(text)),
    ).toBe("BEGIN:VCARD\nFN:Mira & Co\nEND:VCARD\r\nBEGIN:VCARD\nFN:Two\nEND:VCARD");
  });
  it.each([
    "http://dav.example.org",
    "https://user:password@dav.example.org",
    "https://dav.example.org/#fragment",
  ])("rejects unsafe URL %s before fetching", async (url) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(readCardDav(url, "user", "secret", fetch)).rejects.toThrow("HTTPS CardDAV URL");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects ambiguous Basic usernames", async () => {
    await expect(readCardDav("https://dav.example.org/", "a:b", "secret", vi.fn())).rejects.toThrow(
      "colon",
    );
  });
  it.each([
    "network",
    "http",
    "empty",
    "malformed",
    "large",
  ])("explains %s failures without disclosing credentials", async (failure) => {
    const fetch: typeof globalThis.fetch = async () => {
      if (failure === "network") throw new TypeError("SECRET credential network error");
      if (failure === "http") return new Response("SECRET", { status: 401 });
      if (failure === "large") return new Response("x".repeat(10 * 1024 * 1024 + 1));
      return new Response(failure === "empty" ? "<response/>" : "<broken");
    };
    try {
      await readCardDav("https://dav.example.org/", "user", "SECRET", fetch);
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).toContain("CORS");
      expect(String(error)).toContain(".vcf");
      expect(String(error)).not.toContain("SECRET");
    }
  });
});
