<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-7ehi — MAI-L7 interpretations

1. **What does “normalised input” mean with `flowed: true`?**
   MAI-L7 in `specs/apps/tasks.json` requires both undoing soft breaks and exact
   reconstruction. Options: retain physical lines in segment texts and decode only
   a separate display value, or segment the decoded logical text. Conservative
   implementation: segment logical text; concatenation reproduces CRLF→LF input,
   additionally unstuffed and unflowed only when explicitly requested. `visibleText`
   is always the exact concatenation of body segment texts. Quote depth is retained
   from before unstuffing so an escaped literal `>` cannot become quoted history.

2. **Where does forwarded history end, and which overlapping rule wins?**
   MAI-L7 specifies its start, but no terminator. Options: mark only the separator,
   or mark the remainder as forwarded history. Conservative implementation: a
   separator starts forwarded history through EOF; explicit quote lines and their
   immediately preceding attribution take precedence. Only an unquoted signature
   delimiter before the forwarding marker starts the current author's signature.
   The last eligible delimiter is used globally; its signature stops at the next
   quote block or forwarding marker. Attribution immediately preceding that quote
   block remains attribution. All non-quote segments have depth zero.

3. **How are limits and attribution boundaries counted?**
   MAI-L7 / `14-pure-libraries-6.md` leave byte encoding, terminal empty lines and
   Outlook header order implicit. Options: JavaScript code units vs UTF-8 bytes,
   physical vs logical lines, permissive header subsets vs the complete block.
   Conservative implementation: enforce 2 MiB of UTF-8 input before normalisation
   and 50,000 physical lines (LF count + 1, including a terminal empty line).
   A bounded, allocation-free preflight counts bytes/lines and validates Unicode
   before normalisation, splitting or pattern matching. Outlook attribution requires
   contiguous From/Sent/To/Subject lines in that order immediately before a quote
   block, allowing blank lines between the attribution and quote. Only the specified
   English/German/French patterns are recognised; other prose remains literal body.
   The task's space-separated `>` depth rule also applies to flowed input.

These choices do not block implementation; the dispatcher can confirm them at merge.
