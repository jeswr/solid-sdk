<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Project calendar exchange

`toCalendar` adapts the shared `TaskView` projection, structured recurrence and tracker label
names to the VTODO exchange library. Callers supply the clock. UIDs are task subject IRIs;
P1/P2/P3 use the library's 1/5/9 mapping and P4 omits PRIORITY. Calendar timestamps use whole
seconds. Date-only DUE retains the scheduling date marker independently of the stored instant.

`calendarTaskData` delegates field and parent mapping to `toTaskData`. The caller supplies
browser-local midnight for a date-only due date and an explicit map from UIDs to saved resource
IRIs. Date-only recurrence with a matching anchor is representable; UTC timed recurrence,
start/due durations, incompatible UNTIL types and unsupported patterns import as non-repeating
tasks with the original RRULE appended to the description. Preview reports how many repeating
tasks will be imported without repeating. A DTSTART-only series uses DTSTART as the due anchor.
No raw RRULE is persisted as scheduling RDF.

Exports always preserve DUE when a deadline exists. Recurrence would require DTSTART equal to
DUE with the same value type, which the exchange library rejects. Recurring tasks therefore
export without DTSTART or RRULE, with the existing humanised rule appended to DESCRIPTION.

`importLevels` checks parent dependencies and orders parents before descendants. Missing parents
and cycles reject the preview. The state operation writes through `TasksCache`, using its
serialized conditional creates and label writes with at most four scheduled task creates.
Reservations survive retries and ambiguous responses. Task resource names use a SHA-256 hash
of the calendar UID within the selected project's stateStore. Conditional `If-None-Match: *`
creates arbitrate overlapping imports across tabs: a 412 with a matching stored UID is skipped
and supplies the existing resource identity for descendants. Imported UIDs persist as
`dct:identifier` through `TaskItem.calendarUid`; duplicate checks use both that identifier and
the current task subject, within the selected project. Export always uses the current resource
identity.

The sidebar owns the dialog outside the dropdown's unmounted content. Files are parsed before
confirmation, descriptions are never previewed, titles render as text, and errors use a closed
copy map. Downloads use a calendar Blob and revoke the object URL after activating the link.
