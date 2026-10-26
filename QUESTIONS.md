<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-vhu / VOC-05 questions

1. Which authorized checkout should own the portfolio registry change?
   VOC-05 in `specs/vocab/tasks.json` names `jeswr/portfolio`, and DECISIONS V12
   requires changes to its existing `config/persistent-ids.ts` entries, route tests,
   and `docs/persistent-ids.md` inventory. This lane instead targets `jeswr/solid-sdk`
   at `67abf7f1d67285756c2e31e6b2ab801d93cea95a`, where those files and the portfolio
   application are absent. ADR-001 §2 lists portfolio among external deployed apps.
   Options: dispatch VOC-05 in a dedicated portfolio checkout; or explicitly authorize
   an import of portfolio into this workspace with a source and import scope.
   Conservative reading: leave application code unchanged and report the lane blocked
   until the target checkout is corrected. The lane rules prohibit touching other
   checkouts and do not prescribe a local-source import.

The lane rules also prohibit pushing and opening PRs, so this lane cannot itself
complete VOC-05's draft PR and preview deployment. Those steps, including the preview
curl acceptance checks, remain with the integrating owner after the repository
mismatch is resolved. Production deployment still requires Jesse's go.
