<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-05 questions and conservative readings

1. **01 §9 specialised recovery:** reauth, conflict and name-taken belong to the session dialog,
   ConflictDialog and field/upload conflict respectively. Should ErrorState build these flows or
   expose integration points? This lane keeps the skeleton during reauth, exposes Sign in and
   Review changes callbacks for the owning flows, and renders name-taken as copy only. It does not
   implement session or conflict resolution. Other actions follow the specific §9 table rather
   than adding Retry to every category. Actions requiring application behaviour render only when
   a handler or destination is supplied; Request access also requires the capability.
2. **01 §5/§9 skeleton geometry:** list/grid density heights are specified, but document/detail/table
   placeholder counts and document/detail heights are not. Should these acquire new dimensions?
   This lane uses the mockups' 12px bars, 20px icons, row-h rows, row-h-grid-card cards and existing
   spacing tokens. Document/detail grow with their contents; table includes a control-h header.
3. **00 §4 A-7 classification boundary:** the façade is not present in this base. Should suite-ui
   classify SDK exceptions itself? This lane accepts the documented categories (plus retryAfterMs)
   and leaves StorageError classification to the façade, as 01 §9 requires.
