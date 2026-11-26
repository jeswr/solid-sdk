// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  CODE_SCHEMES,
  HEALTH,
  HealthCode,
  HealthInstant,
  HealthPatient,
} from "@jeswr/solid-health";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { copyDataset } from "../core/incremental.js";
import type { VocabMap } from "../core/types.js";
import { METRICS, type Metric } from "./health-vocab.js";

/** Complete metric helper fragments here so the session does not count them as
 * imported items. Named, deterministic nodes also keep merge/reimport idempotent.
 */
export const vocabMap: VocabMap = (doc) => {
  const dataset = copyDataset(doc.dataset);
  for (const quad of doc.dataset) {
    if (
      quad.predicate.value !== `${NS.RDF}type` ||
      quad.object.value !== HEALTH.Observation ||
      quad.subject.termType !== "NamedNode"
    )
      continue;
    // Archive measurement IDs encode their metric and UTC-midnight calendar day.
    const match = /#garmin-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(quad.subject.value);
    if (!match || !Object.hasOwn(METRICS, match[1] as string)) continue;
    const iri = quad.subject.value;
    const [, codeValue] = METRICS[match[1] as Metric];
    // Keep generated mutations local to this observation's helpers; merging
    // unchanged helper quads avoids repeatedly validating the monthly dataset.
    const helpers = new Store();
    const code = new HealthCode(`${iri}-code`, helpers, DataFactory).mark();
    code.codeValue = codeValue;
    if (/^(?:55423-8|8867-4|93832-4)$/.test(codeValue)) code.scheme = CODE_SCHEMES.loinc;
    const instant = new HealthInstant(`${iri}-time`, helpers, DataFactory).mark();
    instant.types.add(HEALTH.TemporalEntity);
    instant.dateTime = new Date(`${match[2]}T00:00:00Z`);
    new HealthPatient(`${iri.split("#")[0]}#subject`, helpers, DataFactory).mark();
    for (const helper of helpers) dataset.add(helper);
  }
  return { ...doc, dataset };
};
