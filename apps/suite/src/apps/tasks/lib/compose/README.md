<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Composer adapter

`parseQuickAdd(text, context)` adapts the shared quick-add parser to the Tasks model.
The required `now` and `tz` control both scheduling and chip copy. All-day values retain
their calendar marker and use the first valid instant of that date if midnight is skipped;
an entirely skipped date throws `RangeError`. Reminder phrases share the parser's calendar
qualifier boundaries. Changing the default project clears its tracker-local section.

Each chip has an `id` of `${kind}:${span.start}` and half-open UTF-16 offsets into the
original input. Default chips use an empty span at zero. `removeChip(text, chip, keepText?)`
returns unchanged text and a new `Set<ChipId>`; pass it as `context.keepText` on the next parse.
Only that chip's interpretation is suppressed, and its token becomes literal title text.
Other labels and reminders still parse. Clear or rebase these ids when editing the input.
