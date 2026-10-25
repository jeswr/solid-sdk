<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MON-L1 conservative interpretations

1. **Ambiguous dates** — 09-pure-libraries / MON-L1 requests date-format sniffing but gives no locale default. Options: assume day-first, assume month-first, or require an explicit format when both fit. Implemented: return `null` from sniffing and require the caller to choose when ambiguous. ISO dates are unambiguous.
2. **Duplicate policy** — MON-L1 specifies a date + amount + description hash without an account/currency policy or deletion behaviour. Options: discard matches automatically or return duplicate candidates. Implemented: return separate unique and duplicate arrays, keeping input order; callers must scope comparisons to one account/currency. Hash matches are verified against the canonical tuple to prevent collision-based losses.
3. **Rule precedence and amount representation** — 07-parity-backlog (Money) and MON-L1 leave these unspecified. Options: first or last matching rule, overwrite or preserve existing categories, numeric or decimal-string amounts. Implemented: ordered first match, preserve existing categories, all predicates within a rule must match, inclusive signed decimal-string ranges, decimal-string amounts. No default currency is invented.
