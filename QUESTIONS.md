<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

1. Brief §Task, “at least one `*.invalid.ttl` per NodeShape”: several shapes
   have no constraints, and Core InformationResourceShape/CategoryShape only
   declare `sh:minCount 0`. Options: change the profiles to make these reject
   data, or require negative coverage only for enforceable property constraints.
   Conservative interpretation: preserve the profiles and cover every NodeShape
   with enforceable properties, including properties inherited through `sh:node`.
   Reusable shapes without targets are exercised through their targeted callers.
   Diet's two node-level genetic safety shapes produce no `sh:resultPath`, so
   they cannot have the specified path-based negative fixture; their existing
   rules remain active when validating every diet fixture.

2. Brief §Task, “every sector under `sectors/*`”: options are immediate child
   directories only, or recursive discovery. Conservative interpretation:
   discover recursively, including `health/diet`, with matching fixture paths.
