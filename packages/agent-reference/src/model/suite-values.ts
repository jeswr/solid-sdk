// AUTHORED-BY Codex GPT-6
/** Typed live access to the existing open-domain RDF model, at the legacy ingress seam. */
import { TermAs } from "@rdfjs/wrapper";
import { digestOf } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import type { ItemTerms } from "../gates/common.js";
import { NamedValuesNode, readValue } from "./named-values.js";
import { StatementQualityNode } from "./quality.js";

export class SuiteValuesNode extends NamedValuesNode {
  static fromSignedPayload(input: unknown): SuiteValuesNode {
    if (input instanceof SuiteValuesNode) return input;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("Expected an object domain payload");
    const node = NamedValuesNode.from(
      input as JsonObject,
      `urn:awp:suite-value:${digestOf(input).slice(8)}`,
    );
    return new SuiteValuesNode(TermAs.term(node), node.dataset);
  }
  private field(name: string) {
    const matches = this.entries.filter((entry) => entry.name === name);
    if (matches.length > 1) throw new TypeError("Ambiguous domain field");
    return matches[0]?.domainValue;
  }
  fieldsOnly(names: readonly string[]): boolean {
    return this.entries.every((entry) => names.includes(entry.name));
  }
  string(name: string): string | undefined {
    const term = this.field(name);
    if (term === undefined) return undefined;
    const value = readValue(term, this.dataset);
    if (typeof value !== "string") throw new TypeError("Expected a string domain value");
    return value;
  }
  number(name: string): number | undefined {
    const term = this.field(name);
    if (term === undefined) return undefined;
    const value = readValue(term, this.dataset);
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new TypeError("Expected a finite number domain value");
    return value;
  }
  node(name: string): SuiteValuesNode | undefined {
    const term = this.field(name);
    if (term === undefined) return undefined;
    if (term.termType !== "NamedNode" && term.termType !== "BlankNode")
      throw new TypeError("Expected a domain node");
    const node = new SuiteValuesNode(term, this.dataset);
    if (!node.isObject && !node.types.has("https://schema.org/ItemList"))
      throw new TypeError("Expected a named value collection or list");
    return node;
  }
  records(name: string): readonly SuiteValuesNode[] {
    const list = this.node(name);
    if (!list) return [];
    if (list.isObject) throw new TypeError("Expected an ordered domain list");
    return list.entries.map((entry) => {
      const node = new SuiteValuesNode(entry.domainValue, this.dataset);
      if (!node.isObject) throw new TypeError("Expected a record in the list");
      return node;
    });
  }
  strings(name: string): readonly string[] {
    const list = this.node(name);
    if (!list) return [];
    if (list.isObject) throw new TypeError("Expected an ordered domain list");
    return list.entries.map((entry) => {
      const value = readValue(entry.domainValue, this.dataset);
      if (typeof value !== "string") throw new TypeError("Expected a string in the list");
      return value;
    });
  }
  get contentDigest(): string {
    return digestOf(this.toObject());
  }
  get quality(): StatementQualityNode {
    const period = this.node("period");
    return StatementQualityNode.from({
      claimType: this.string("claimType") ?? "",
      issuer: this.string("issuer"),
      subject: this.string("subject"),
      method: this.string("method"),
      asOf: this.string("asOf"),
      issuedAt: this.string("issuedAt"),
      validUntil: this.string("validUntil"),
      ...(period
        ? { period: { start: period.string("start") ?? "", end: period.string("end") ?? "" } }
        : {}),
    });
  }
  get terms(): ItemTerms | undefined {
    return this.node("terms")?.toObject() as unknown as ItemTerms | undefined;
  }
}
