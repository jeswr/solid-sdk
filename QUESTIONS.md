<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lane sst-8xm.22 interpretations

1. Does the display-name cap include a label defaulted from the WebID? (Brief, Task 3.)
   Options: cap every newly written display label, or exempt WebID fallback labels.
   Conservative choice implemented: cap every newly written label at 256 Unicode code
   points, including fallbacks and preserved names when rewritten. Keep the full WebID
   in the account identifier. Existing persisted records are not migrated on read.
   This interpretation does not block the lane; no answer is required to review it.
