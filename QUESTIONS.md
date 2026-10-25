<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# DS-01 questions

1. **01 §2.1 and §7: normative contrast failures.** Should the spec amend the colours, or explicitly reduce the claimed thresholds? Conservative implementation: preserve every normative value and report only the exact theme/pair/measurement below as a known spec issue. Alpha borders are composited over the named background in encoded sRGB; out-of-gamut channels are clipped to sRGB.

| Theme | Foreground | Background | Measured | Required |
|---|---|---|---|---|
| light | `--warning-foreground` | `--warning` | 4.331:1 | 4.5:1 |
| light | `--border-strong` | `--background` | 1.786:1 | 3:1 |
| dark | `--border-strong` | `--background` | 2.095:1 | 3:1 |

Machine-readable entries used by `check:contrast` (stale entries fail the gate):

<!-- contrast-issue: light|--warning-foreground|--warning|4.331 -->
<!-- contrast-issue: light|--border-strong|--background|1.786 -->
<!-- contrast-issue: dark|--border-strong|--background|2.095 -->

2. **01 §2.3–2.7: unnamed supporting tokens.** Options: invent a second naming scheme, or reuse the reference mockups. Conservative reading: use mockup names (`--lh-*`, `--font-*`, `--shadow-*`, `--rail-w`, `--sidebar-w`, `--topbar-h`, `--radius-full: 9999px`); add descriptive names only for sizes/weights/tracking explicitly specified but unnamed. Density values live in `density.css`; the typed inventory includes both densities. Dark elevation fills are separate fill tokens. No application chrome is added.

3. **01 §2.7: Comfortable vs 44px touch targets.** Comfortable controls are 36px/28px, while touch requires 44px. Options: preserve control heights on touch, or enforce the explicit touch minimum. Conservative reading: retain Comfortable row/grid/text/cell values and raise both control height tokens to 44px on coarse pointers.
