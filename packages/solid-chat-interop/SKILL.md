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

Normalization strips C0/C1 controls except tab/CR/LF, then every Unicode
General_Category=Cf character except:

- U+200D between two Extended_Pictographic characters, with optional U+FE0F and/or an
  emoji modifier following each pictograph (either modifier/selector order).
- U+E0020–U+E007F tags in a complete sequence immediately after U+1F3F4, ending at the
  first U+E007F. Remove orphan, interrupted and unfinished tags, and all other Cf.

`redactSecretFields` takes fields in persistence order: title, messages, or source chunks.
After per-field redaction it inspects each adjacent 512-code-unit suffix/prefix with no
separator, replacing only values covered by detections spanning the join. It also checks
normalized source windows, because an earlier per-field marker can hide a token prefix.
Carry source ranges through existing replacements; never reconstruct plaintext from an
already-redacted value. Collect all boundary ranges before applying them.

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
