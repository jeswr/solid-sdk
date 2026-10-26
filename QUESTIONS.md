<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-09 questions

1. 01 §5 / 00 §8 require profile display through `useProfile`, but the SDK façade and DS-02 UI primitives are absent from this checkout. Options: introduce an SDK dependency, fetch profiles inside the picker, or inject the hook. Conservative implementation: PeoplePicker receives a `useProfile` hook prop and contact-source snapshots; consumers supply the real hook. No network or storage work enters suite-ui. Local Radix wrappers provide the required component primitives.
2. 03 §2.5 specifies equal-weight Cancel/Share without choosing a variant. Options: both primary or both outline. Conservative implementation: both use the same outline button class, equal-width grid columns and identical dimensions. The browser spec compares and snapshots computed styles.
3. 01 §5 specifies Custom duration without its input anatomy. Options: date or date/time. Conservative implementation: a labelled native date field with a controlled ISO date string; no time-zone or expiry computation in these pure UI components.

These choices need no additional SDK or product behavior. Browser comparison with the mockups is deferred to the dispatcher because the lane explicitly prohibits launching Playwright.
