<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-08 questions and conservative defaults

1. **Missing prerequisite (brief dependency; DESIGN §2–3).** The supplied base
   `917d3be9` contains neither MCP-01's PodPort nor its tool registry. Options:
   import MCP-01, block, or expose a structurally compatible chat storage port and
   adapt the current server. Chosen: the latter, confined to chat functionality;
   no remote/local branch imports or unrelated MCP-01 reconstruction.
2. **Message identity (DESIGN §4 chat row, §6).** The input row omits message IDs,
   although storage requires them. Options: require IDs or accept optional IDs.
   Chosen: preserve explicit `id`; otherwise derive a SHA-256 ID from role, text,
   and normalized createdAt. Identical ID-less messages collapse; capture callers
   should supply source IDs to distinguish identical events.
3. **List contract (DESIGN §4 chat row).** Paging/order/since are unspecified.
   Options: timestamp or URL ordering; inclusive or exclusive since. Chosen:
   conversation URL ascending, exclusive cursor (last returned URL), limit 1–100
   (default 20), exclusive since against latest message createdAt. Filter before
   paging; no mutable shared index. Provider is optional on list.
4. **Metadata and privacy (DESIGN §4 Storage).** Options: mutable titles or
   create-only metadata. Chosen: first saved title wins, message IDs are immutable;
   ACLs grant only the owner Read/Write/Control with inherited defaults, written
   before chat container/content writes. The enclosing `private/` ACL is untouched. Failure to write an ACL aborts the save.
   The port/server must support writing the conventional `.acl` before content;
   no permissive fallback. Provider IDs are `claude`, `chatgpt`, `codex`.
5. **Writes (DESIGN §4, existing server config).** Options: allow chat_save by
   default or preserve the existing read-only default. Chosen: chat_save requires
   `readOnly:false` and a valid owner WebID; reads require the owner too so all
   chat operations use the same owner-bound writer.
