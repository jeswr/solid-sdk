// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { availableAdapters } from "../src/derive/adapters/index.js";
import {
  REQUIRED_TYPED_RECORDS,
  recordEntryDataset,
  recordEntryFrom,
  recordGraphIri,
} from "../src/model/store/record.js";
import { type LedgerEntry, verifyLedgerAtHead } from "../src/store/ledger.js";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";
import { captureModelCorpus } from "./helpers/model-corpus.js";

const awp = "https://w3id.org/jeswr/awp#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

it(
  "round-trips and re-verifies every captured agent ledger against the untyped ratchet",
  async () => {
    const untyped = new Set<string>();
    const seen = new Set<string>();
    const failures = new Set<string>();
    let count = 0;
    let agentLedgers = 0;
    const registry = await availableAdapters();
    const corpus = await captureModelCorpus(registry, (ledger) => {
      agentLedgers++;
      const decoded = ledger.entries().map((entry) => {
        const graph = recordGraphIri(entry.hash);
        const dataset = recordEntryDataset(entry);
        const parsed = readNQuads(writeNQuads(dataset));
        const type = entry.record.type;
        seen.add(type);
        const payload = dataset.getObjects(graph, awp + "record", graph)[0]!;
        const actual = dataset.getObjects(payload, rdfType, graph)[0]?.value;
        if (actual === awp + "UntypedRecord") {
          untyped.add(type);
          if (REQUIRED_TYPED_RECORDS.has(type))
            failures.add(
              JSON.stringify({
                type,
                fields: Object.keys(entry.record).sort(),
                reason: entry.record.reason,
                check: entry.record.check,
                outcome: entry.record.outcome,
                verdict: entry.record.verdict,
              }),
            );
        } else if (REQUIRED_TYPED_RECORDS.has(type)) {
          expect(actual).toBe(REQUIRED_TYPED_RECORDS.get(type));
        }
        const copy = recordEntryFrom(parsed, graph) as LedgerEntry;
        const digest = digestOf(entry);
        const ordered = JSON.stringify(entry.record);
        for (const result of [recordEntryFrom(dataset, graph), copy]) {
          if (digestOf(result) !== digest || JSON.stringify(result.record) !== ordered)
            throw new Error(
              `Record value or field order changed for ${type} at sequence ${entry.seq}`,
            );
        }
        count++;
        return copy;
      });
      expect(verifyLedgerAtHead(decoded, ledger.head()).ok).toBe(true);
    });
    expect(corpus.paths).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(0);
    expect(seen.has("gate-check")).toBe(true);
    const baseline = JSON.parse(
      readFileSync(new URL("fixtures/record-untyped-baseline.json", import.meta.url), "utf8"),
    );
    console.log(
      `Record corpus checked ${count} entries from ${agentLedgers} ledgers over ${corpus.paths} paths.`,
    );
    expect({ requiredUntyped: [...failures].sort(), untyped: [...untyped].sort() }).toEqual({
      requiredUntyped: [],
      untyped: baseline.types,
    });
  },
  process.env.FULL_CORPUS === "1" ? 3_600_000 : 1_200_000,
);
