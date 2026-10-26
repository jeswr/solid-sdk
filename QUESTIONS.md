<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# HLT-L4 scope questions

1. Which canonical units and UCUM subset should HLT-L4 expose? The HLT-L4 task
   and specs/apps/12-pure-libraries-4.md name measures without listing codes or
   canonicals. Options: a full UCUM parser or an explicit bounded table. Conservative
   implementation: bounded table; mass kg, length/distance m, temperature Cel,
   blood glucose mmol/L, blood pressure mm[Hg], energy kJ, duration s. Document
   accepted codes and explicit customary aliases in the library README; reject
   every other spelling rather than guessing. Require the measure on conversions
   and observations so glucose chemistry is never inferred from unit strings.

2. Which glucose molar mass does “exact conversion factors” mean? The older
   health/stats helper uses an explicitly approximate factor of 18. Options: keep
   that approximation or use the NLM UCUM example's fixed molar mass 180.156 g/mol.
   Conservative implementation: the latter, giving 18.0156 mg/dL per mmol/L,
   represented as an integer ratio. This is exact relative to the stated molar
   mass convention, not a claim of exact physical molecular mass. Return JS
   numbers without display rounding; leave the existing stats API unchanged.
