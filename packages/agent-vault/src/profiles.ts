// AUTHORED-BY Codex GPT-6.1-Sol
import type { CredentialStore } from "@jeswr/agent-credentials";
import type { LoginRoute } from "@jeswr/site-model";
import { DataFactory, Parser, Store, Writer } from "n3";
import { z } from "zod";
import { boundary, identifier, origin, parse, VaultError } from "./safe.js";

export const profileSchema = z.strictObject({ id: identifier, label: z.string().min(1).max(100) });
export const accountSchema = z.strictObject({
  id: identifier,
  site: z.string(),
  profile: identifier,
  label: z.string().min(1).max(100),
  emailDomain: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .optional(),
  backend: z.string().max(100).optional(),
  item: z.string().max(200).optional(),
});
export type Profile = z.infer<typeof profileSchema>;
export type Account = z.infer<typeof accountSchema>;
const routeSchema = z.strictObject({
  account: identifier,
  site: z.string(),
  profile: identifier,
  method: z.string().regex(/^(password|passkey|magic-link|otp|sso:[a-z0-9-]+)$/),
  provider: identifier.optional(),
  providerAccount: identifier.optional(),
  operation: z.string().optional(),
  sessionCookies: z.array(z.string()).optional(),
  probeUrl: z.string().optional(),
  refresh: z
    .strictObject({
      urlTemplate: z.string(),
      tokenPointer: z.string(),
      expiresInPointer: z.string().optional(),
    })
    .optional(),
});
export type AccountRoute = z.infer<typeof routeSchema> & LoginRoute;
const graphSchema = z.strictObject({ turtle: z.string().max(60000) });
const SAB = "https://jeswr.org/ns/site-action#";
const SCHEMA = "https://schema.org/";
const { namedNode, literal, quad } = DataFactory;
/** Facts only; never pass credentials, cookies or tokens as profile labels or route metadata. */
export class Profiles {
  readonly #store: CredentialStore;
  constructor(store: CredentialStore) {
    this.#store = store;
  }
  #read(): Store {
    try {
      return new Store(
        new Parser().parse(this.#store.privateRecord("account-graph", graphSchema)?.turtle ?? ""),
      );
    } catch {
      throw new VaultError("unavailable");
    }
  }
  async #put(kind: string, id: string, value: object): Promise<void> {
    return boundary(() =>
      this.#store.withLock("vault-account-graph", async () => {
        const g = this.#read();
        const s = namedNode(`urn:agent-vault:${kind}:${id}`);
        g.removeQuads(g.getQuads(s, null, null, null));
        // Each property is a separate RDF fact. Structured refresh/sessionCookies use rdf:JSON literals.
        for (const [k, v] of Object.entries(value))
          if (v !== undefined) {
            g.addQuad(
              quad(
                s,
                namedNode((k === "label" ? SCHEMA : SAB) + k),
                typeof v === "string"
                  ? literal(v)
                  : literal(
                      JSON.stringify(v),
                      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON"),
                    ),
              ),
            );
          }
        const writer = new Writer({ prefixes: { sab: SAB, schema: SCHEMA } });
        writer.addQuads(g.getQuads(null, null, null, null));
        const turtle = await new Promise<string>((resolve, reject) =>
          writer.end((e, s) => (e ? reject(e) : resolve(s))),
        );
        this.#store.putPrivateRecord("account-graph", graphSchema, { turtle });
      }),
    );
  }
  #list<T>(kind: string, schema: z.ZodType<T>): T[] {
    try {
      const g = this.#read();
      const prefix = `urn:agent-vault:${kind}:`;
      return g
        .getSubjects(null, null, null)
        .filter((s) => s.value.startsWith(prefix))
        .map((s) => {
          const raw: Record<string, unknown> = {};
          for (const q of g.getQuads(s, null, null, null)) {
            if (q.object.termType !== "Literal") throw new VaultError("invalid");
            const k = q.predicate.value.startsWith(SAB)
              ? q.predicate.value.slice(SAB.length)
              : q.predicate.value.slice(SCHEMA.length);
            raw[k] = q.object.datatype.value.endsWith("#JSON")
              ? JSON.parse(q.object.value)
              : q.object.value;
          }
          return parse(schema, raw);
        });
    } catch {
      throw new VaultError("unavailable");
    }
  }
  profiles(): Profile[] {
    return this.#list("profile", profileSchema);
  }
  accounts(site?: string): Account[] {
    return this.#list("account", accountSchema)
      .filter((a) => !site || a.site === origin(site))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  route(site: string, account: string): AccountRoute | undefined {
    return this.#list("route", routeSchema).find(
      (r) => r.site === origin(site) && r.account === account,
    );
  }
  putProfile(input: Profile): Promise<void> {
    return boundary(() => {
      const p = parse(profileSchema, input);
      return this.#put("profile", p.id, p);
    });
  }
  putAccount(input: Account): Promise<void> {
    return boundary(() => {
      const a = parse(accountSchema, input);
      a.site = origin(a.site);
      if (!this.profiles().some((p) => p.id === a.profile)) throw new VaultError("invalid");
      const old = this.accounts().find((p) => p.id === a.id);
      if (old && (old.site !== a.site || old.profile !== a.profile))
        throw new VaultError("invalid");
      return this.#put("account", a.id, a);
    });
  }
  putRoute(input: AccountRoute): Promise<void> {
    return boundary(() => {
      const r = parse(routeSchema, input);
      r.site = origin(r.site);
      if (!this.accounts(r.site).some((a) => a.id === r.account && a.profile === r.profile))
        throw new VaultError("invalid");
      if (
        r.method.startsWith("sso:") &&
        (!r.providerAccount ||
          r.provider !== r.method.slice(4) ||
          !this.accounts().some((a) => a.id === r.providerAccount && a.profile === r.profile))
      )
        throw new VaultError("invalid");
      return this.#put("route", r.account, r);
    });
  }
}
