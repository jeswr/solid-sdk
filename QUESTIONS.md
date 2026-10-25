<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-02 conservative interpretations

1. §3 specifies PDF/DATA badges and app hues, but leaves other type badges and neutral hues unspecified. Options: invent abbreviations/colours or use only explicit badges and neutral foreground for folder/archive/text/unknown. Implemented the latter; CSV/XLS use the mockup's spreadsheet abbreviation, based on content type or filename.
2. §3 requests 20px app glyphs; mockup `.hex.sm` uses 16px at 32px. Options: follow the mockup exception or the normative §3 size. Implemented 20px at all three sizes, with the mockup's rounded SVG polygon geometry.
3. §2.3/§7 set a 12px minimum while mockup file badges and count badges use 8–10px. Options: copy those smaller labels or follow the accessibility requirement. Implemented 12px, retaining badge shape and tokens.
4. Kbd, StatusDot and CountBadge are named without prop/state contracts (§3/§5). Implemented native kbd children, labelled success/warning/destructive/info/neutral status dots, and nonnegative integer counts (0 stays visible; 100+ displays 99+ with the full accessible count). No additional product states.
5. §9 applies to async surfaces. These primitives/atoms do not load application data. Fixtures demonstrate Skeleton, indeterminate/determinate Progress, first-use/filtered empties and typed-error copy using primitives; the later suite state components remain out of this lane's scope.
