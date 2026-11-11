---
name: suite-charts
description: Use when adding a chart, graph, sparkline or stat tile to a Suite app. Provides accessible React SVG charts and framework-free scale and statistics helpers.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Use `@jeswr/suite-charts` instead of writing app-local SVG charts. Read the
[package API and examples](README.md) for prop types and behaviour.

Import components from the package root, helpers from `@jeswr/suite-charts/scale`,
and `@jeswr/suite-charts/styles.css` after suite-ui token and theme styles. Add a
`workspace:*` dependency in workspace consumers. The scale entry has no React
imports and is suitable for server/data code.

Choose LineChart for numeric/time series, BarChart for categories, ScatterChart
for paired observations and TimelineChart for lanes of intervals or events.
Sparkline and StatTile provide compact summaries. Supply a useful title, units,
stable IDs and a description explaining the observations. Aggregate and interpret
data in the app; chart components perform no storage or network work.

Keep these invariants when integrating or extending the package:

- One y axis and one unit per line chart. Numeric x values cannot mix with Date/ISO
  x values. Dates and default time labels use UTC; wrap numeric timestamps in Date
  when a line chart should use time mode.
- Series array position owns its palette slot. Fold more than five series into
  “Other” before rendering. Preserve dash patterns, neutral text, the legend,
  keyboard tooltips, large point hit targets and the table alternative.
- Active timeline items with no end continue through `now`; inject `now` in tests
  or deterministic SSR. Other end-less items are point events.
- A trend requires at least three finite points and variance on both axes. State
  association cautiously in app copy; the component reports r and sample count.
- Use the host's suite-ui colour tokens and `sc-` classes. Preserve reduced-motion,
  forced-colour, empty-data and 320px behaviour. Do not add chart framework dependencies.

Validate changes with the package's Turbo lint/build/typecheck/test gate and root
lint gate. Pure helper tests run in Node; component tests opt into jsdom. Keep the
`scale` dependency graph React-free and verify SSR without browser globals.
