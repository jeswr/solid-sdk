<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-11 questions

1. **TypedView integration (01 §5; Drive §2.7, §4.6).** The supplied base has no
   `TypedView` implementation or registry. Options: implement that separate component here,
   or accept a renderer slot from its owner. Conservative choice: `PreviewPane.typedView`
   accepts the output of `TypedView`; without it, data files show the download fallback.
   DS-11 never parses or exposes raw data. The fixture supplies a plain-language example card.
2. **DS-02 primitives (brief dependency; 01 §5).** The supplied base has tokens but no
   Button/Progress/other shared React primitives. Options: build a complete primitive library,
   or implement only the controls needed by DS-11. Conservative choice: native buttons and
   Radix Progress with the normative tokens, Lucide icons, and Tailwind v4 consumer styling.
3. **Queue ownership (Drive §4.1; DRV-02/05).** Storage scheduling, conflict resolution and
   persistence belong to the later Drive lanes. Options: implement that transport here, or
   expose controlled presentation plus a pure state reducer. Conservative choice: export the
   reducer (including a three-active-upload limit) and action callbacks; do not perform writes
   or claim durable/resumable uploads. The caller owns cancellation of transport requests.
