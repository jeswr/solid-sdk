// AUTHORED-BY Codex GPT-6
/** TEST DOUBLE. HMACs prove nothing about hidden data; every test party shares the key. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHmac } from "crypto";
import { canonicalJson, digestOf } from "../../src/core/canonical.js";
import type { Json, JsonObject } from "../../src/core/types.js";
import type { ProofBinds, ProofSystem } from "../../src/derive/verifiers.js";

export class ToyProofSystem implements ProofSystem {
  readonly kind = "test-double" as const;
  constructor(
    readonly method = "sparq-zk-result/5",
    readonly binds: readonly ProofBinds[] = ["rule", "issuers", "fresh"],
    private readonly key = "PUBLIC TEST KEY",
  ) {}
  private mac(value: unknown) {
    return createHmac("sha256", this.key).update(canonicalJson(value)).digest("hex");
  }
  async issuerKeygen(seed: Uint8Array) {
    const publicKey = { testKey: digestOf([...seed]) };
    return { publicKey, secretKey: publicKey };
  }
  async issue(input: Parameters<ProofSystem["issue"]>[0]) {
    const credential = {
      issuerKey: input.issuerKey,
      subject: input.subject,
      claims: input.claims,
      status: input.status ?? {},
    };
    return { ...credential, signature: this.mac(credential) };
  }
  async prove(input: Parameters<ProofSystem["prove"]>[0]): ReturnType<ProofSystem["prove"]> {
    const dataset = input.policy.dataset as JsonObject | undefined;
    if (
      dataset &&
      digestOf(dataset.credentialDigests) !== digestOf(input.credentials.map(digestOf).sort())
    )
      throw new Error("toy dataset differs from receiver agreement");
    for (const credential of input.credentials) {
      const { signature, ...unsigned } = credential;
      if (signature !== this.mac(unsigned)) throw new Error("bad toy credential");
    }
    const claims = input.credentials.flatMap((c) => {
      const claims = c.claims as JsonObject;
      return Array.isArray(claims.statements) ? (claims.statements as JsonObject[]) : [claims];
    });
    const byKind = (kind: string) =>
      claims.find((c) => c.claimType === decodeURIComponent(kind))?.value;
    const query = input.query;
    const patterns = [...query.matchAll(/<urn:claim:([^>]+)> (\?\w+)/g)];
    const values = new Map(patterns.map((p) => [p[2] as string, byKind(p[1] as string)]));
    let result: Json;
    const comparison = query.match(/BIND\(\(\?value (<=|>=|<|>|=) (.+?)\) AS/);
    const aggregateComparison = query.match(
      /^SELECT DISTINCT \(\((MIN|MAX|SUM|COUNT)\(\?value\) (<=|>=|<|>|=) (.+?)\) AS/,
    );
    if (aggregateComparison) {
      const ns = claims
        .filter((c) => c.claimType === decodeURIComponent(patterns[0]?.[1] ?? ""))
        .map((c) => Number(c.value));
      if (!ns.length) throw new Error("no toy aggregate inputs");
      const a =
          aggregateComparison[1] === "MIN"
            ? Math.min(...ns)
            : aggregateComparison[1] === "MAX"
              ? Math.max(...ns)
              : aggregateComparison[1] === "COUNT"
                ? ns.length
                : ns.reduce((a, b) => a + b, 0),
        b = JSON.parse(aggregateComparison[3] as string);
      result =
        aggregateComparison[2] === ">="
          ? a >= b
          : aggregateComparison[2] === "<="
            ? a <= b
            : aggregateComparison[2] === ">"
              ? a > b
              : aggregateComparison[2] === "<"
                ? a < b
                : a === b;
    } else if (query.includes("AS ?test")) {
      const results: boolean[] = [];
      for (const m of query.matchAll(
        /\?subject <urn:claim:([^>]+)> \?v(\d+) \. BIND\(\(\?v\d+ (>=|<=|=) (.+?)\) AS \?test\d+\)/g,
      )) {
        const a = byKind(m[1] as string) as number,
          b = JSON.parse(m[4] as string);
        results.push(m[3] === ">=" ? a >= b : m[3] === "<=" ? a <= b : a === b);
      }
      for (const m of query.matchAll(
        /NOT EXISTS \{ \?subject <urn:claim:([^>]+)> \?excluded\d+ \. FILTER\(\?excluded\d+ IN \((.*?)\)\)/g,
      )) {
        const list = byKind(m[1] as string),
          excluded = JSON.parse(`[${m[2]}]`) as string[];
        if (!Array.isArray(list)) throw new Error("toy missing complete list");
        results.push(list.every((v) => !excluded.includes(String(v))));
      }
      if (!results.length) throw new Error("toy unsupported condition");
      result = query.includes(" && ") ? results.every(Boolean) : results.some(Boolean);
    } else if (comparison) {
      const a = values.get("?value") as number | string;
      const token = comparison[2] as string;
      const b =
        token === "?other" ? values.get("?other") : JSON.parse(token.split("^^")[0] as string);
      result =
        comparison[1] === "<="
          ? a <= b
          : comparison[1] === ">="
            ? a >= b
            : comparison[1] === "<"
              ? a < b
              : comparison[1] === ">"
                ? a > b
                : a === b;
    } else if (query.includes(" IN (")) {
      const list = query.match(/ IN \((.*?)\)\)/)?.[1];
      result = (JSON.parse(`[${list}]`) as Json[]).includes(values.get("?value") as Json);
    } else if (query.includes(" && ") || query.includes(" || ")) {
      const vs = [...values.values()];
      if (vs.some((v) => typeof v !== "boolean")) throw new Error("toy needs boolean inputs");
      result = query.includes(" && ") ? vs.every(Boolean) : vs.some(Boolean);
    } else {
      const kind = patterns[0]?.[1];
      const ns = claims
        .filter((c) => c.claimType === decodeURIComponent(kind ?? ""))
        .map((c) => Number(c.value));
      if (!ns.length) throw new Error("no toy inputs");
      result = query.includes("SUM(")
        ? ns.reduce((a, b) => a + b, 0)
        : query.includes("COUNT(")
          ? ns.length
          : query.includes("MIN(")
            ? Math.min(...ns)
            : query.includes("MAX(")
              ? Math.max(...ns)
              : ([...values.values()][0] as Json);
    }
    const payload = {
      query,
      policy: input.policy,
      nonce: input.nonce,
      result,
      issuerKeys: input.credentials.map((c) => c.issuerKey as JsonObject),
      credentialDigests: input.credentials.map(digestOf),
    };
    return { presentation: { payload, hmac: this.mac(payload) }, result };
  }
  async verify(input: Parameters<ProofSystem["verify"]>[0]): ReturnType<ProofSystem["verify"]> {
    const p = input.presentation.payload as JsonObject;
    if (
      !p ||
      input.presentation.hmac !== this.mac(p) ||
      p.query !== input.expectedQuery ||
      p.nonce !== input.nonce ||
      digestOf(p.policy) !== digestOf(input.policy)
    )
      return { ok: false, reason: "toy request mismatch" };
    if (
      (p.issuerKeys as JsonObject[]).some(
        (key) =>
          !(input.policy.issuerKeys as JsonObject[]).some(
            (accepted) => digestOf(key) === digestOf(accepted),
          ),
      )
    )
      return { ok: false, reason: "toy issuer outside receiver policy" };
    return {
      ok: true,
      released: p.result as Json,
      binds: this.binds,
      issuerKeys: p.issuerKeys as JsonObject[],
    };
  }
}
