<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# DS-04 questions

1. **DetailsPane breakpoint** — 01-§4 and the HTML mockups use a persistent pane at
   ≥1280 and a sheet below; the task and 02-§2 say Sheet <1024. Options: sheet below
   1280, or sheet below 1024. This lane follows the explicit brief / 02-§2: a 360px
   persistent pane at ≥1024, a right Sheet below 1024.
2. **768px boundary** — 01-§2.4 / task describe a sidebar drawer ≤768 and a 48px
   TopBar ≤768, while 01-§4 and 02-§2 put 768 in md. Options: mobile chrome at 768,
   or md chrome. Follow 02-§2 / mockups: rail at 768, tab bar below 768, 56px TopBar
   at 768; the sidebar is a drawer throughout 768–1023 as well as on mobile.
3. **Missing DS-02 / SDK preferences** — despite the dependency note, this base has
   only the DS-01 token files in suite-ui, no Radix primitives, React dependencies,
   or usePreferences hook. Options: stop for another base, or add the minimal
   required Radix/Lucide dependencies and expose controlled layout preferences.
   This lane takes the latter, with browser-only persistence on dev fixtures.
   Production pod-backed persistence belongs to SDK-APP-11 (RECONCILE A-22);
   consumers can connect it through preferences / onPreferencesChange.
