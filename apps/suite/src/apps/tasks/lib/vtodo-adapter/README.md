<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Project calendar exchange

`toCalendar` adapts the shared `TaskView` projection, structured recurrence and tracker label
names to the VTODO exchange library. Callers supply the clock. UIDs are task subject IRIs;
P1/P2/P3 use the library's 1/5/9 mapping and P4 omits PRIORITY. Calendar timestamps use whole
seconds. Date-only DUE retains the scheduling date marker independently of the stored instant.

`calendarTaskData` delegates field and parent mapping to `toTaskData`. The caller supplies
browser-local midnight for a date-only due date and an explicit map from UIDs to saved resource
IRIs. Supported RRULEs pass through the existing suite-ui parser and Tasks recurrence adapter;
unsupported patterns reject the entire preview before writes. No raw RRULE is persisted.
Tasks has no start date: recurring exports supply DTSTART one second before timed DUE or one
day before date-only DUE to satisfy the exchange library's strict ordering requirement.
The Tasks import uses DUE as its recurrence anchor; start is exchange metadata.

`importLevels` checks parent dependencies and orders parents before descendants. Missing parents
and cycles reject the preview. The state operation writes through `TasksCache`, using its
serialized conditional creates and label writes with at most four scheduled task creates.
Reservations survive retries and ambiguous responses. Imported UIDs persist as `dct:identifier`
through `TaskItem.calendarUid`; duplicate checks use both that identifier and the current task
subject, within the selected project. Export always uses the current resource identity.

The sidebar owns the dialog outside the dropdown's unmounted content. Files are parsed before
confirmation, descriptions are never previewed, titles render as text, and errors use a closed
copy map. Downloads use a calendar Blob and revoke the object URL after activating the link.
