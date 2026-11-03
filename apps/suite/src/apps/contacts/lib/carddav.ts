// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchDav } from "@jeswr/solid-dav-bridge/browser";
import { SaxesParser } from "saxes";
import { secureContactUrl } from "./form-schema";

/** No pod fetch, cookies, redirects, persistence or error details containing credentials. */
export async function readCardDav(
  url: string,
  username: string,
  password: string,
  fetch: typeof globalThis.fetch,
): Promise<string> {
  if (!secureContactUrl(url) || new URL(url).hash)
    throw new Error(
      "Enter an HTTPS CardDAV URL (localhost is allowed). Do not include credentials in the URL.",
    );
  if (username.includes(":")) throw new Error("The CardDAV username cannot contain a colon.");
  try {
    const scoped: typeof globalThis.fetch = (target, init) =>
      fetch(target, {
        ...init,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    const text = await fetchDav(url, {
      fetch: scoped,
      davAuth: { type: "basic", username, password },
      method: "REPORT",
      accept: "application/xml, text/vcard",
      body: '<c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:address-data/></d:prop><c:filter><c:prop-filter name="FN"/></c:filter></c:addressbook-query>',
      signal: AbortSignal.timeout(30000),
      maxBytes: 10 * 1024 * 1024,
    });
    if (text.trimStart().startsWith("BEGIN:VCARD")) return text;
    // Extract only CardDAV address-data, decoding XML entities without an HTML DOM.
    const cards: string[] = [];
    let reading = false;
    let card = "";
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      if (tag.local === "address-data" && tag.uri === "urn:ietf:params:xml:ns:carddav") {
        reading = true;
        card = "";
      }
    });
    const append = (text: string) => {
      if (reading) card += text;
    };
    parser.on("text", append);
    parser.on("cdata", append);
    parser.on("closetag", (tag) => {
      if (tag.local === "address-data" && tag.uri === "urn:ietf:params:xml:ns:carddav") {
        cards.push(card);
        reading = false;
      }
    });
    parser.write(text).close();
    if (!cards.length) throw new Error("No address data");
    return cards.join("\r\n");
  } catch {
    throw new Error(
      "Could not read this CardDAV server. Check the address and credentials. The server may block browser access (CORS); export a .vcf file and import it instead.",
    );
  }
}
