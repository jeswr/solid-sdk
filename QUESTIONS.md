<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-07 implementation questions

1. The brief says DS-02 is merged, but this base contains only suite-ui tokens, with no React primitives or UI test harness. Options: stop for DS-02, or add the minimum dependencies and local Radix menu composition needed for DS-07 (01 §5). Conservative choice: the latter; do not implement the wider DS-02 primitive catalogue.
2. Section 5 does not define persistence, remote suggestions, free-form tag creation, or rename blur behavior. Options: asynchronous storage-backed controls, or synchronous controlled components. Conservative choice: synchronous callbacks and supplied autocomplete options; tags select existing labels, Enter commits a rename, Escape cancels, and blur leaves the draft open. No storage or network surface is introduced, so §9 remote loading/error states do not apply. Fixtures include disabled, empty, filtered-empty and validation states.
3. The read-first paragraph requests browser comparison of mockups, while the binding UI rule prohibits launching Playwright in this lane. Conservative choice: inspect reference source and write the full viewport/theme screenshot matrix for dispatcher execution; no browser launch here.
