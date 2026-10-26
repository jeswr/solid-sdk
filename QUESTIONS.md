<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-06 questions and conservative readings

1. The brief says DS-02 is merged, but this base exposes tokens only in suite-ui (§5).
   Options: import another branch, implement the missing primitive library, or use native controls.
   This lane uses native labelled checkbox/button/details controls and existing tokens; it does not
   import another branch or implement unrelated primitives.
2. §5/§6 do not define selection persistence when filtering. Options: discard hidden selections or
   preserve them. Stable item IDs retain selection; select-all and deselect-all affect only the
   currently supplied (filtered) items. Ranges follow the current sorted/filtered order. A plain row
   click replaces selection; checkbox/Space toggles; Shift extends from the last non-range anchor.
3. §5 gives FileGrid no card width or thumbnail aspect ratio. Options: invent a new card design or
   reuse §2.7 card heights and the mockups' bordered card/well anatomy. This lane uses the latter,
   with a responsive minimum 200px card width and 16px gaps. Consumers supply preview content.
4. The brief requires opening mockups in Playwright and also explicitly prohibits launching
   Chromium in this lane. The prohibition takes precedence: reference HTML/CSS is read locally;
   the dispatcher runs the committed screenshot, axe, keyboard and performance specs.
