<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-tr79 — conservative interpretations

1. MAI-L3 / specs/apps/10-pure-libraries-2.md does not prescribe an API or the supported
   RFC syntax subset. Options: parse free-form mailbox syntax, or accept structured addresses.
   Chosen: structured ASCII dot-atom mailboxes with DNS domains; quoted locals, groups,
   comments, domain literals and SMTPUTF8 addresses produce `ComposeError`. Unicode display
   names, subjects and attachment filenames are supported. No transport or UI is added.
2. MAI-L3 does not specify identity matching or self-sent replies. Options: lowercase entire
   mailboxes or preserve case-sensitive local parts. Chosen: preserve local parts, compare
   domains case-insensitively, remove all supplied identities, deduplicate recipients with To
   taking precedence over Cc. Reply-To overrides From; when that target is only self, use the
   original To recipients. Bcc is never copied or serialized in headers.
3. MAI-L3 leaves forward threading/attachments unspecified. Options: retain thread metadata
   and attachments, or start a new draft. Chosen: forward starts with no recipients, references,
   HTML or attachments; its plain text quotes the original with a UTC attribution line. Replies
   extend References (or a single In-Reply-To fallback) with the parent's Message-ID; missing
   parent IDs omit In-Reply-To while preserving known ancestry in References (RFC 5322 §3.6.4). Prefix matching is case-insensitive and does not
   repeat an existing Re:/Fwd: prefix.
4. MAI-L3 asks for parser round trips "where available". MAI-L1 is absent from this base.
   Chosen: synthetic fixed wire fixtures plus independent decoding checks; no parser dependency.
