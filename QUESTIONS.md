<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SH-L1 implementation questions

1. **Key format and boundaries** — `apps/tasks.json` SH-L1 and
   `specs/apps/09-pure-libraries.md` require base-62 keys but specify no existing
   wire format. Options: introduce integer-prefixed keys compatible with an external
   library, or use plain fractional digits. Conservative choice: fractional digits
   from `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`, with `null`
   as either open bound. Keys are nonempty and cannot end in `0`, which excludes
   adjacent prefix pairs with no possible key between them. Compare with `<` / `>`
   or default `.sort()`, never locale collation. No external format compatibility
   is assumed.
2. **Rebalance API** — the same sections name a helper without a signature.
   Options: mutate application items, return an old/new mapping, or return replacement
   keys. Conservative choice: `rebalanceKeys(keys: readonly string[]): string[]`
   validates strictly increasing input and returns compact replacement keys in the
   same positional order. Callers own persistence and any concurrent-write handling.
