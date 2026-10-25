<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# MAI-00 conservative interpretations

1. Mail vocabulary: 07-parity-backlog §Mail says the existing model is unchanged, while the
   cross-cutting text references suite-vocab (absent from this base). Options: preserve pod-mail's
   `http://schema.org/` terms or change schemes. Preserve the existing terms for interoperability.
2. Stars: §Mail requires stars but pod-mail only defines the dateRead flag. Options: invent a
   boolean predicate or use the specified schema:Collection membership. Use a `starred` collection;
   read/unread continues to use schema:dateRead. Labels retain folder membership in both directions.
3. Takeout: MAI-01 names mbox/Takeout without an archive format contract. Options: accept extracted
   Gmail `.mbox` streams (including X-Gmail-Labels), or add ZIP handling. Accept extracted streams;
   ZIP extraction belongs to the later file connector. Raw `.eml` storage remains enabled.
4. Multi-document writes: §Mail specifies separate message, thread and folder documents, without a
   transaction protocol. Use sequential conditional writes, surface the first failure, and require
   callers to reload after conflict/partial completion; do not claim atomicity or blindly retry.
5. Type Index bootstrap: 08-model-first excludes the SDK; 00 §10 delegates profile/index bootstrap
   to SDK-APP-10. This model registers into a caller-supplied existing index and preserves its data;
   the later hook supplies discovery/bootstrap through the SDK.
