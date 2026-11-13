// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { LabelIndex } from "../src/model/labels.js";
import type { TraceFile } from "../src/trace/types.js";

it("uses ontology and profile RDF labels and retains each replaced identifier as a reference", () => {
  const labels = new LabelIndex();
  labels.add("urn:test:operation", "Read the balance");
  labels.add("urn:test:party", "The fictional bank");
  const event = labels.annotations(
    {
      part: "outbound-gate",
      kind: "check",
      caption: "Use urn:test:operation: with urn:test:party.",
      rule: { id: "urn:test:rule", text: "https://w3id.org/jeswr/awp#Message" },
    },
    "fixed-vocabulary",
  );
  expect(event.caption).toBe("Use Read the balance: with The fictional bank.");
  expect(event.rule).toEqual({ id: "urn:test:rule", text: "Message" });
  expect(event.refs?.map((ref) => ref.id)).toEqual([
    "urn:test:operation",
    "urn:test:party",
    "https://w3id.org/jeswr/awp#Message",
  ]);
});

it("keeps generated captions and rule explanations free of identifiers in every produced scenario trace", () => {
  const root = join(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8")) as {
    paths: { trace?: string; status: string; configuration?: string }[];
  };
  let traces = 0;
  for (const path of manifest.paths) {
    if (!path.trace) continue;
    traces++;
    const trace = JSON.parse(readFileSync(join(root, "traces", path.trace), "utf8")) as TraceFile;
    for (const event of trace.events) {
      expect(event.caption, `${path.trace} event ${event.seq}`).not.toMatch(/https?:\/\/|urn:/);
      expect(event.rule?.text ?? "", `${path.trace} event ${event.seq}`).not.toMatch(
        /https?:\/\/|urn:/,
      );
    }
  }
  const baseline = manifest.paths.filter((path) => !path.configuration);
  const alternatives = manifest.paths.filter((path) => path.configuration);
  expect(traces).toBe(157 + alternatives.filter((path) => path.trace).length);
  expect(baseline.filter((path) => path.status === "runs")).toHaveLength(146);
  expect(baseline.filter((path) => path.status === "disagrees")).toHaveLength(11);
  expect(baseline.filter((path) => path.status === "blocked")).toHaveLength(9);
  expect(alternatives).toHaveLength(8);
  expect(alternatives.every((path) => path.status === "runs")).toBe(true);
});

it("preserves exact original content in principal review even when it contains a URI", () => {
  const labels = new LabelIndex();
  const text = '<svg xmlns="http://www.w3.org/2000/svg">Original drawing</svg>';
  const event = labels.annotations(
    {
      part: "principal",
      kind: "ask-principal",
      caption: "Review the original.",
      chat: { who: "agent", text },
    },
    "fixed-vocabulary",
  );
  expect(event.chat?.text).toBe(text);
});
