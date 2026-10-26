<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# HLT-L6 interpretations

1. **Metric names and blood-pressure input** — HLT-L6 in `specs/apps/tasks.json`
   and `14-pure-libraries-6.md` specify clinical names but no DTO spellings or
   paired-value shape. Options: infer aliases/pair separate observations, or use
   one explicit closed DTO. Chosen: `weight`, `height`, `heartRate`, `steps`,
   `bodyTemperature`, `oxygenSaturation`, `bloodPressure` (consistent with existing
   Health camelCase names); blood pressure has `value: { systolic, diastolic }`.
   Separate systolic/diastolic metrics are rejected, never paired heuristically.
2. **Unspecified clinical state and source mapping** — same task. Options:
   infer active/completed medication status from dates, or preserve uncertainty.
   Chosen: MedicationStatement status `unknown`; no Condition clinical status
   is inferred. Observation source is preserved as an annotation (`note.text`)
   prefixed with `Source: `, without assuming it identifies a clinician/device.
3. **Absent patient** — the task permits patient-less export, whereas R4 requires
   a subject on MedicationStatement and Condition. Options: omit the required
   subject, reject those records, or use a display-only Reference. Chosen:
   `{ display: "Patient not supplied" }` for those required subjects; Observation
   omits subject. Only an explicit logical patient ID yields `Patient/<id>`.
   No Patient resource or patient identity is fabricated. The self-check validates
   this exporter’s structural subset, not full FHIR profiles/clinical validity.
4. **Ordering and dates** — same task. Options: input kind order or lexical FHIR
   resource kind order. Chosen: Condition, MedicationStatement, Observation;
   chronological onset/start/effective within each, then code-unit ID order.
   Observations require full zoned ISO timestamps; medication/condition dates
   also accept Gregorian YYYY-MM-DD (midnight UTC for sorting only). Values are
   preserved, with at most millisecond precision; malformed/ambiguous dates fail.
