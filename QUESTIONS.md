<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MON-L2 interpretation questions

1. **Overspend rollover** — 07-parity-backlog, Money parity checklist; 10-pure-libraries-2.
   Should negative available carry into the same envelope, reduce next month's unassigned
   pool, or become credit debt? Conservative implementation: carry the entire signed
   available into the same envelope. Never erase debt or deduct it twice. No credit-specific
   rules are specified, so callers supply ordinary cash-envelope activity only.
2. **Reporting conventions** — same sections specify reports without date/sign conventions.
   Options include instants vs civil dates, gross vs refund-adjusted spending, and including
   vs excluding transfers. Conservative implementation: explicit inclusive Gregorian civil
   dates, expense refunds reduce spending, internal transfers excluded from spend/cash flow,
   signed account balances (liabilities negative). No exchange-rate conversions.
3. **Currency subset and incomplete balances** — same sections specify neither the subset nor
   missing-balance imputation. Implement AUD/CAD/CHF/EUR/GBP/USD (2 digits), JPY (0), KWD (3);
   reject all others. Net worth uses last known balances at each requested date and rejects a
   date without a baseline for every supplied account instead of assuming zero. A caller must
   explicitly supply zero for an account before opening or after closure when appropriate.

These choices keep the pure core usable without making UI or storage-model decisions.
