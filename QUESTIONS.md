<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# TSK-L4 conservative interpretations

1. **Time zones** (06-tasks §4.7, §5.3; TSK-L4): support floating/TZID values with a time-zone engine, or reject them? This pure subset accepts DATE and UTC DATE-TIME only. All-day dates remain calendar dates; projecting them to the model requires the caller's explicit midnight instant, rather than assuming the host zone.
2. **Parent identity** (06-tasks §5.3; TSK-L4 RELATED-TO): treat an arbitrary calendar UID as a resource IRI, or require resolution? Preserve the parent UID and require an explicit UID-to-HTTP(S)-resource map for the task-model projection. External parents are allowed when mapped; unresolved parents fail closed.
3. **Model refinements** (06-tasks §5.3–5.4; TSK-L4): discard finer STATUS/PRIORITY values and RRULE, or retain exchange metadata? Retain exact optional iCalendar status and numeric priority alongside the binary state and high/medium/low projection. CANCELLED is closed, COMPLETED is closed, other states are open. RRULE is opaque passthrough metadata only, never interpreted or persisted as the structured recurrence model. Converting it to scheduling RDF belongs to the recurrence layer.
4. **Supported envelope** (12-pure-libraries-4; RFC 5545 §3.6.2): accept partial components and silently skip unknown data, or require a complete supported calendar? Require VCALENDAR VERSION 2.0/PRODID, at least one VTODO, and UID/DTSTAMP/nonblank SUMMARY on every task (the task model requires a title). Reject unsupported components, properties, parameters, duplicate singleton fields/UIDs, and inconsistent dates. Preserve GREGORIAN CALSCALE when supplied. No scheduling METHOD or alarms are supported.

These choices do not block this lane; broader formats need an explicit follow-up contract.
