---
name: solid-type-index
description: Use when discovering or registering Solid data by RDF class, reading publicTypeIndex or privateTypeIndex links, creating missing Type Index documents, or implementing TypeRegistration wrappers and bounded pod search.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Use the Solid Type Index

The Type Index advertises where data of a given RDF class lives. It is a discovery hint, not an authorization grant.

## Read

1. Fetch the WebID/profile and locate `solid:publicTypeIndex` or `solid:privateTypeIndex`.
2. Fetch the index and find `solid:TypeRegistration` subjects whose `solid:forClass` matches the desired class.
3. Read either `solid:instance` for one resource or `solid:instanceContainer` for a collection.
4. Fetch the discovered location and apply its real access controls.

## Register

- Create a `TypeRegistration` with exactly one of `solid:instance` or `solid:instanceContainer`.
- Use typed `DatasetWrapper`/`TermWrapper` classes and RDF/JS terms; do not concatenate Turtle or hand-add quads.
- Serialize the full dataset with `n3.Writer` and use conditional `PUT` with explicit Turtle content type.
- On `412`, re-fetch, reapply the registration, and retry according to the caller's bounded conflict policy.

## Bootstrap missing indexes

Do not assume the server seeded them. When an index is genuinely absent, create a `solid:TypeIndex` plus `solid:ListedDocument` (public) or `solid:UnlistedDocument` (private), then link it from the profile/preferences resource. Never overwrite an index or preferences document that was merely unreadable.

Keep the profile publicly readable and protect the private index itself through the effective access-control system.

## Search and security

- Validate every profile-linked index and registered location against the user's advertised storage roots before attaching credentials.
- Use parsed origin plus path-segment containment, not raw string prefix.
- Bound client-side pod search by source count, result count, and wall-clock time, including the discovery phase.
- De-duplicate results by resource URL and label capped results as incomplete.
- Scheme-filter every RDF-derived URL before rendering it as a link or image.

When interoperating with a deployed application, verify the actual predicates its shipping code reads and writes; a vocabulary document alone may not reflect de-facto data.
