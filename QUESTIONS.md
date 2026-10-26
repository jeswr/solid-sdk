<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-03 questions

1. **Missing DS-02 surface** (brief dependency; 01 §3/§5): the supplied base has tokens and
   the DS-01 fixture host, but no AppIcon or Radix wrappers. Options: stop for DS-02, or add
   the minimum icon/primitive support required by DS-03. Conservative choice: add only the
   launcher/navigation support; do not recreate the broader DS-02 component inventory.
2. **Preferences integration** (02 §3; 00 §8 A-22; RECONCILE A-22): this checkout has no
   `@jeswr/suite-sdk/react` or `usePreferences`. Options: implement SDK persistence here,
   or expose a controlled provider boundary for the forthcoming SDK hook. Conservative
   choice: `RailPreferencesProvider` supplies `usePreferences('rail')` with value/update,
   loading and classified-error state. Only the dev fixture uses browser persistence;
   production per-account pod/cache/outbox persistence remains SDK-APP-11's responsibility.
3. **Mobile app order** (01 §5 versus 02 §2): “4 apps + More” could mean the first four pinned
   apps, while 02 explicitly names Home, Drive, Docs, Tasks. Conservative choice: keep those
   four fixed on mobile; rail preferences change desktop pins only.
4. **Backlog in visual reference** (02 §3 versus shell-drive mockup): the mockup shows Calendar,
   Contacts, Notes and Photos in the primary grid. Conservative choice: follow normative §3,
   hiding all backlog apps unless the environment flag is `1`, then place them in a collapsed
   “Coming soon” group.
