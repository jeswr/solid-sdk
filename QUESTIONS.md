<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# MON-L6 interpretations

1. **Date window and ambiguity** — `specs/apps/13-pure-libraries-5.md` and
   MON-L6 in `tasks.json` do not prescribe a default window or a tie-breaker.
   Options: choose nearest dates, solve a global assignment, or report all
   competing candidates. Conservative implementation: require an explicit
   nonnegative `maxDays`, use inclusive Gregorian calendar-day differences,
   and pair only mutual sole candidates. Report every affected transaction's
   candidate IDs; do not resolve chains by elimination. Require an explicit
   list of the user's financial account IDs, reject out-of-scope entries, and
   match only equal currency codes (07-parity-backlog, Money, multi-currency).

2. **Merge/unsplit representation** — MON-L6 and 07-parity-backlog's Money
   section do not define a split DTO or merging unrelated transactions.
   Options: merge arbitrary ledger entries, or reverse a split of one original
   transaction. Conservative implementation: retain the existing Money rules
   `MoneyTransaction` DTO as the original, with at least two `{ categoryId,
   amount }` parts. Parts use signed safe integer minor units of the original
   currency and must sum exactly; zero and offsetting parts need no rounding.
   `mergeSplit` (also exported as `unsplitTransaction`) validates the split
   again and returns a fresh copy of the complete original, including its
   category. No general merge, generated IDs, nested splits or persistence.
