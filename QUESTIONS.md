<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-fwm1 questions

1. SHT-L1 requests conversion to the SHT-00 storage model (tasks.json, SHT-L1;
   07-parity-backlog.md, Sheets / Data mapping decisions), but SHT-00 is not in this
   checkout and is not a dependency of SHT-L1. Options: wait for its concrete API,
   or prove the boundary with engine snapshots, ordered CSVs and inferred column
   metadata in memory. This lane takes the latter conservative option. It does
   not invent RDF accessors, a persistent format, or network writers. SHT-00 must
   consume these projections through its own typed RDF writers when integrated.
