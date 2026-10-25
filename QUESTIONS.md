<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MAI-L1 conservative interpretations

1. `09-pure-libraries.md` and MAI-L1 require sanitised HTML with no remote loads by
   default, but do not specify an opt-in rendering API. Options: permit remote images
   behind a flag, or always remove automatic resource loads in this library. This
   lane chooses the latter. CID images become inert `data-inline-cid` references;
   a future reader can resolve these against attachment bytes under its own policy.
   Ordinary links remain user-activated. No UI or network API is added.

2. MAI-L1's "plain-text and sanitised-HTML extraction" does not specify whether to
   synthesise missing representations. Options: generate plain text from HTML, or
   expose the actual representations present. This lane retains the parser's
   extraction semantics: HTML-only mail has an empty plain body, and plain-only
   mail has null HTML.
