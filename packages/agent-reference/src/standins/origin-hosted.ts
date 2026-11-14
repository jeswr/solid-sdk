// AUTHORED-BY Codex GPT-6
/** Fictional source HTTP endpoints and independently signed register address answers. */
import { createGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import type { JsonObject } from "../core/types.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { signStatement } from "../mechanisms/statements.js";
export class FictionalOriginDirectory {
  readonly requests: string[] = [];
  private readonly bodies = new Map<string, string>();
  private readonly anchors = new Map<string, string>();
  private readonly addresses = new Map<string, string>();
  private readonly sources = new Map<string, string>();
  readonly fetch = refuseRedirects(
    createGuardedFetch({
      requireDnsPinning: true,
      maxBytes: 65536,
      maxRedirects: 0,
      dnsLookup: async (host) => {
        if (![...this.bodies.keys()].some((url) => new URL(url).hostname === host))
          throw new Error("No fictional origin DNS entry");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      pinningFetch: async (input) => {
        const request = new Request(input);
        this.requests.push(request.url);
        const body = this.bodies.get(request.url);
        return new Response(body ?? "", {
          status: body ? 200 : 404,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  );
  constructor(
    readonly register: { identity: string; key: SigningKey },
    private readonly at: string,
  ) {}
  async publish(address: string, record: JsonObject): Promise<void> {
    const id = String(record.id);
    this.sources.set(id, String(record.issuer));
    this.bodies.set(address, JSON.stringify(record));
    this.addresses.set(id, address);
    this.anchors.set(
      id,
      await signStatement(this.register.key, "awp-source-address+jws", {
        type: "SourceAddress",
        issuer: this.register.identity,
        subject: String(record.issuer),
        recordId: id,
        address,
        issuedAt: this.at,
        validUntil: new Date(Date.parse(this.at) + 86400000).toISOString(),
      }),
    );
  }
  locator(id: string, lookalike = false): string {
    const anchor = this.anchors.get(id),
      address = this.addresses.get(id);
    if (!anchor || !address) throw new Error("Unknown origin record");
    return JSON.stringify({
      source: this.sources.get(id),
      recordId: id,
      pointer: lookalike ? "https://northbank-lookalike.example/product" : address,
      anchor,
    });
  }
}
