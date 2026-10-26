<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MAI-L5 interpretation questions

1. `07-parity-backlog.md`, Mail “Filters / rules”, and `12-pure-libraries-4.md` do not specify operators, text normalization, or priority. Options: implicit case folding/pattern syntax/priority numbers, or literal operators and input array order. Conservative implementation: explicit `equals`/`contains`, case-sensitive text without normalization, exact per-address matching for from/to, integer byte comparisons (`equals`/`greater-than`/`less-than`), nested nonempty all/any groups, and array order. Callers supply decoded address strings and complete plain body text; MIME/header/HTML parsing is outside this library.
2. The same sections do not define contradiction or stop semantics. Options: last move wins, first move wins, or reject different destinations. Conservative implementation: reject conflicting moves within a rule and across matching rules that would run. Labels are additive; mark-read and star only set flags. Stop processing takes effect after all actions of its matching rule. Dry-run still reports matches after stop, with `applied: false`, and validates every rule before evaluation.
