<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DRV-L6 policy readings

1. **Budget accounting** — `specs/apps/tasks.json` DRV-L6 says to limit “kept
   unlabelled versions” but also says labelled versions can leave limits exceeded.
   Options: prune against unlabelled usage, or prune against all retained usage.
   Conservative reading: prune only when unlabelled usage exceeds a limit; report
   `overBudget` against all retained versions. This avoids deleting extra history
   solely because labelled versions occupy the budget.
2. **Newest protection** — DRV-L6 says “keep the newest version always” before
   budget pruning. Options: protect it throughout, or allow the budget pass to
   delete it. Preserve it throughout and report `overBudget` if it alone exceeds
   either limit. Other recent unlabelled versions remain eligible for budget pruning.
3. **Age boundaries** — DRV-L6 names adjacent age bands and “older than 30 d”.
   Options: place exactly 30 days in daily or weekly thinning. Use hourly thinning
   at exactly 24 hours, daily thinning at exactly 7 days and exactly 30 days, and
   weekly thinning strictly after 30 days. Buckets are scoped to each age band.
