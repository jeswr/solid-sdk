<!-- AUTHORED-BY Codex GPT-6 -->
# Brief 39 explorer polish

- UTF-8 and the title are on the first lines of the static page and the hosted fragment.
- Home uses all 16 chapters for the 5:45 walkthrough and the supplied caption. The player already pointed at the supplied poster and caption track.
- Home and Layers count the model's 11 layers. Settlement appears under Commitments as a choice made at the point of payment. The roadmap uses “Layer specifications” and identifies the maintainer by role.
- The mortgage stage uses North Bank and Harbour Bank from the model and identifies both principals as fictional. The over-ask replay says the gate stopped evidence sharing because the mandate did not allow it. The injected-fee replay gives the same reason for stopping the fee. The scrubber, phone and inspector use the recorded outcomes for diverging steps.
- The phone names the underwriter in the sharing request, gives the mandate's resources plain descriptions and displays “Pay the valuation fee” once. The generic bank names, missing resource labels and doubled verb are in the engine's exported text. The explorer applies these changes when it renders the replay. Raw events retain the exported wording.
- The counter, scrubber and inspector use consecutive positions. The mortgage baseline has 36 positions. The recorded step numbers still resolve in existing links.
- The inspector indents JSON-LD and keeps its context toggle. Attachment digests wrap and can be selected in full. Message labels sit below the envelope's path.

## Verification

- `node --test --test-isolation=none test/*.test.mjs` passed all 24 tests with the local Node 24.22.3 binary. The default Node 22 binary uses a different flag name.
- `node scripts/bundle-data.mjs` succeeded with 278 trace entries. The tests also built a hosted fragment and checked its UTF-8 declaration.
- The supplied MP4 measured 345.635 seconds. The test checks the chapter times, seeking and the paths used for the poster and captions.

## Layout checks for the orchestrator

I reviewed the CSS and tested the SVG geometry with Node. Browser verification is pending.

- At **360 px**, the Explore grid has one flexible column. The stage has at most 328 px of inner width before scrollbars or safe-area insets, and the two agents stack at the same scale. The scrubber and party strip have their own horizontal scrolling. Digests and other long prose wrap, and raw data and table content have their own overflow.
- At **1280 × 720**, the side panels take 248 px and 294 px, leaving 738 px for the stage and about 714 px inside its padding. The agents draw side by side at the same width. The stage body can scroll vertically when a long caption or the payment selector reduces the available height.
- In a browser at both widths, check that the document and `#view` each have `scrollWidth === clientWidth` on Home, Layers and Explore. In Explore, open Configuration, play a message, open the JSON-LD context and inspect Raw during a payment step. At 360 px, drag the scrubber to the last step and check it scrolls within the timeline. At 1280 × 720, check the gate labels and the wire label during packet movement and confirm the payment controls leave the full diagram reachable.
