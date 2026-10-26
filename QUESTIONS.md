<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.21 conservative interpretations

1. **No matching membership rule: `deny` or `notApplicable`?**
   Brief: Task, fail-closed paragraph; Acceptance criteria, denied cases.
   Options: change the evaluator's decision matrix to force `deny`, or preserve
   its existing unsatisfied-constraint semantics. Chosen: preserve
   `notApplicable` when no rules match and document default deny for enforcement.
   An unevaluable membership constraint never matches a permission or prohibition.
   Other independently matching rules retain their existing conflict semantics.

2. **Must the policy declare the collection's RDF type?**
   Brief: Task, PartyCollection IRI and injected resolver requirements; ODRL 2.2
   Information Model §2.5 / Vocabulary §4.1 as referenced in Read first.
   Options: require an `rdf:type odrl:PartyCollection` declaration inside every
   policy graph, or let the injected resolver identify the collection. Chosen:
   the resolver identifies it; membership requires one clean absolute collection
   IRI and one clean absolute recipient IRI. Arrays, literal datatypes, and other
   left operands remain unsupported. Policy serializers reject malformed forms;
   parsing retains malformed membership as an unsatisfied constraint so it cannot
   become an unrestricted permission.

Neither interpretation blocks this lane. No specification or network fetch was used.
