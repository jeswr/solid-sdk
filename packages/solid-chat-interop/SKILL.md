---
name: solid-chat-interop
description: Use when implementing or consuming @jeswr/solid-chat-interop conversation persistence, transcript export, redaction, or AS2/LongChat conversion.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Chat persistence and redaction

Read [README.md](README.md) and conversation archive decision
[0005](../../decisions/0005-conversation-archive.md) before changing persistence.
Keep RDF access through existing typed wrappers and serialization through n3.Writer.

`ChatWriter.save` redacts before deriving IDs or making any write. Preserve ACL-first,
owner-only, create-only writes. `renderTranscript` repeats redaction for legacy records.
Neither path logs input or errors containing credentials.

The 10 November value-only decision preserves assignment names, operators, quotes and
surrounding code. Use `[REDACTED]` for values and boundary pieces; retain existing
per-field PEM/token/header markers. Reuse the detectors in `src/redact.ts`.

Normalization strips lone surrogates (Cs), C0/C1 controls except tab/CR/LF, then every Unicode
General_Category=Cf character except:

- U+200D between two Extended_Pictographic characters, with optional U+FE0F and/or an
  emoji modifier following each pictograph (either modifier/selector order).
- Subdivision flags: U+1F3F4, exactly two tag lowercase letters (U+E0061–U+E007A),
  then 1–4 tag lowercase letters or digits (U+E0030–U+E0039), then U+E007F.
  England/Scotland/Wales survive. Strip all other U+E0000–U+E007F tags and other Cf;
  a black flag cannot carry an arbitrary hidden ASCII instruction.

`redactSecretFields` takes fields in persistence order: title, messages, or source chunks.
`redactConversation` is the shared title/messages mapping used by save, transcript export
and capture; preserve all other conversation/message metadata and do not mutate input.
After per-field redaction it inspects each adjacent 512-code-unit suffix/prefix with no
separator, snapping edges inward to code-point boundaries. Replace only values covered
by detections whose full context spans the join (including a URL password's trailing `@`,
even when its value is wholly on the left). It also checks
normalized source windows, because an earlier per-field marker can hide a token prefix.
Carry source ranges through existing replacements; never reconstruct plaintext from an
already-redacted value. Collect all boundary ranges before applying them.
Ignore zero-width boundary spans. Preserve existing markers byte-for-byte, including
when a span lies entirely inside/on one; absorb touching newly exposed fragments into
their coverage rather than rewriting or duplicating markers. Appending a neighbour must
not change a fully detected message's text or its derived ID. Require F(F(fields)) = F(fields).
A marker-only left value ends boundary continuation, so replay cannot advance the
512-unit window through the next field. Original source windows still cover fragments.
Recheck edited fields with the per-field detectors: removing a boundary fragment can
expose an assignment formerly hidden inside another detector's syntax.

Redact orphan private-key END lines from the field start through the last END delimiter,
even without a previous field. This conservative per-field rule covers long PEM bodies
split after BEGIN, beyond the fixed boundary window. Keep following text after END.

Apply this to a complete capture/import conversation before queueing, filtering, or
splitting into one-message saves or batches. Retain source chunks until these checks
finish. Repeating only per-field redaction loses the context needed by the next field.
Existing stored records remain create-only; transcript export supplies legacy protection.

Keep work linear in input size plus field count. Never join whole conversation prefixes
or scan beyond the fixed windows. This bounded, adjacent-pair policy does not detect
credentials requiring three fields or context farther than 512 code units from a join.
Separator-free detection is conservative: a token at a field's end may consume the first
word of the next field. Ordinary joins without a detector match remain unchanged.

Test every token split position, assignment/code preservation, normalization before
storage/export, admitted emoji byte preservation, queue replay and import batch joins.
Use count-based bounds for work and marker growth, with injected pod transports.
