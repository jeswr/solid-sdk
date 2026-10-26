<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Health measurement units

Pure TypeScript, with no React, RDF, storage or network access. Import from `./index`.

```ts
import { convertUnit, normaliseObservation } from "./index";

convertUnit(98.6, "[degF]", "Cel", "temperature"); // approximately 37
const reading = normaliseObservation({
  id: "https://example.org/observations/fictional-weight",
  measure: "mass",
  value: 150,
  unit: "lb",
} as const); // fresh record: unit "kg", value approximately 68.0388555
```

| Measure | Canonical unit | Accepted UCUM codes |
| --- | --- | --- |
| `mass` | `kg` | `kg`, `g`, `mg`, `[lb_av]`, `[oz_av]` |
| `length`, `distance` | `m` | `mm`, `cm`, `m`, `km`, `[in_i]`, `[ft_i]`, `[yd_i]`, `[mi_i]` |
| `temperature` | `Cel` | `Cel`, `[degF]`, `K` |
| `blood-glucose` | `mmol/L` | `mg/dL`, `mmol/L` |
| `blood-pressure` | `mm[Hg]` | `mm[Hg]` |
| `energy` | `kJ` | `J`, `kJ`, `kcal` |
| `duration` | `s` | `ms`, `s`, `min`, `h`, `d` |

Explicit input/output aliases: `lb` → `[lb_av]`, `oz` → `[oz_av]`, `in` → `[in_i]`,
`ft` → `[ft_i]`, `yd` → `[yd_i]`, `mi` → `[mi_i]`, `mmHg` → `mm[Hg]`.
`resolveUnit(code)` returns the corresponding UCUM code; `canonicalUnit(measure)`
returns the table's canonical unit. Unit matching is case sensitive. Whitespace,
display symbols, arbitrary prefixes, compound expressions, annotations, calendar
months/years and unlisted aliases are rejected, including unsupported identity
conversions. This is a bounded UCUM subset, not a general UCUM parser.

`convertUnit(value, from, to, measure)` requires the measure explicitly, checks both
units against it, and returns a number without display rounding. Length and distance
share the same dimension. Blood pressure supports scalar mmHg values (e.g. systolic
and diastolic as separate observations); it does not parse `120/80` strings.
Temperature conversions are affine absolute scales, not temperature differences.
This library performs algebraic conversion of signed scalar values, not clinical
plausibility checks or interpretation; callers validate the measurement domain.

The scale table stores integer ratios: 1 international pound = 0.45359237 kg,
1 international inch = 0.0254 m, 1 international mile = 1609.344 m,
1 thermochemical kcal = 4.184 kJ, and 1 day = 86400 elapsed seconds. Temperature
uses the exact Celsius/Kelvin offset 273.15 and Fahrenheit formula `(F - 32) × 5/9`.
These definitions follow the [UCUM specification](https://ucum.org/ucum).
Glucose uses a **fixed molar mass convention of 180.156 g/mol**, matching the
[NLM UCUM mass/mole conversion example](https://ucum.nlm.nih.gov/ucum-service.html):
1 mmol/L = 18.0156 mg/dL. The factors are exact relative to these definitions;
the molar mass convention is not an exact physical constant. This chemistry is
allowed only under `blood-glucose`, never inferred for other analytes. The older
`health/lib/stats` converter remains independent and uses its documented rounded
factor of 18; use this library for HLT-L4 normalisation.

Calculations and returned values use IEEE-754 numbers, so fractional results should
be compared with a tolerance. Identity conversions preserve the input exactly.
Non-finite inputs, overflow, complete underflow to zero, and changes lost entirely
when adding a temperature offset fail closed; other floating point rounding is
inherent in the numeric API. No input strings are parsed or coerced.

`normaliseObservation({ measure, value, unit, ...metadata })` returns a shallow copy
with canonical `unit` and converted `value`, retaining other fields and their types.
It never mutates inputs, including frozen records. Metadata is opaque and is not
validated or recursively cloned; adapt RDF/QUDT data through the caller's typed data
layer. It validates scalar records and propagates conversion errors. Normalising
an already canonical observation is idempotent.

All validation failures throw `UnitError` (an `Error`) with a stable `code`:
`unknown-unit`, `unknown-measure`, `incompatible-unit`, `invalid-value`,
`invalid-observation` or `numeric-range`. Messages contain no observation values.
There are no dependencies. `apps/suite/test/health-units.test.ts` exercises the public
barrel; the app's Vitest gate enforces 100% lines, statements, functions and branches
for every TypeScript file in this directory.
