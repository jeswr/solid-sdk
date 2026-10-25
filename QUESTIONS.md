<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# CON-00 conservative scope readings

1. **Multi-document failure policy** — `07-parity-backlog.md`, Contacts data mapping and
   CON-01; `00-sdk-assumptions.md` A-8. The spec requires conditional mutations but does not
   define a transaction or rollback protocol for person/group/index documents. Options:
   attempt compensating writes, or report partial persistence for caller reconciliation.
   Applied: preflight every scope/precondition, use conditional writes, report completed URLs
   in `PartialWriteError`, and never delete a PM source until its replacement and index write
   succeed. No automatic retry or destructive rollback.

2. **Provisioning and Type Index ownership** — `08-model-first.md`; `00-sdk-assumptions.md`
   A-20. Options: duplicate the future SDK's profile/index bootstrap and access-control setup,
   or accept caller-provisioned private containers and an existing linked Type Index URL.
   Applied: the model creates the book and indexes inside caller-provisioned owner-private
   `contacts/`, `people/`, and `groups/`; registration/discovery accept an explicit existing
   Type Index. Missing/unreadable indexes propagate errors. Profile linking, container
   privacy, SDK bootstrap and hooks remain the integration layer's responsibility.

3. **DAV bridge ORG mapping and remote transport** — `07-parity-backlog.md`, Contacts
   existing data layer / CON-01; `08-model-first.md` exclusions. Options: change the shared DAV
   bridge, or reuse its current mapper and accept fetched CardDAV export text. Applied:
   `parseVcards`/`importVcards` use `solid-dav-bridge` unchanged (ORG is folded into note by that
   mapper). PM migration independently preserves `vcard:organization-name` in organization.
   CardDAV credentials, SSRF-safe remote retrieval and the import wizard belong to CON-01/03;
   this model accepts file/export text and injects only the authenticated pod fetch.

4. **Deletion versus trash** — `07-parity-backlog.md`, CON-01 acceptance and CON-02.
   Options: implement app-managed trash policy now, or expose the permanent model deletion
   needed by CON-01 and leave trash/undo to CON-02. Applied: conditional permanent deletion,
   with group/index cleanup. Trash/undo and capability wiring remain CON-02 scope.
