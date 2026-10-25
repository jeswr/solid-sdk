<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-xex interpretation record

1. **Portfolio draft PR versus lane isolation** — VOC-02 acceptance asks for a
   portfolio draft PR, while the lane rules forbid PRs and changes outside this
   checkout. Options: modify portfolio/open a PR, or verify the existing registry
   read-only and leave the PR/deploy to the lead. Take the latter: no registry
   edits are needed if its existing representation URLs work; commit the check
   script and results here. No production deployment is authorized.

2. **Version scope** — VOC-02 says “every ontology” and explicitly lists the main
   core/sector/task/fed/fedreg ontologies. Options: bump only those main documents,
   or also bump suite-owned `owl:Ontology` sidecars and curated import modules.
   Take the literal reading: all rebased suite-owned ontology nodes become 2.0.0
   with version IRIs and an explanatory description. Third-party ontology
   identities and existing `prof:Profile` version histories are preserved.

3. **“fedcon: untouched” versus references to moved namespaces** — DECISIONS V1
   preserves `https://jeswr.org/fedcon#`, while VOC-02 requires removing active
   legacy bases from the whole package. Options: freeze all fedcon files, or
   preserve its terms, ontology identity and version while updating its fedreg
   references. Take the latter so composed contexts and shapes keep working.
