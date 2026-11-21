<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Scenario JSON-LD context v1

Profiles and scenarios use `https://w3id.org/jeswr/awp/context/scenario/v1` with
`agent-profile/0.2` and `agent-scenario/0.2`. The context defines the existing authoring
keys. `readCaseGraph` adds the RDF root IRI and class in memory, assigning
`urn:profile:<id>` or `urn:scenario:<id>` from the file's slug. A property scope decides
whether a nested `id` is an IRI, a slug, or a status-list entry key.

Ordered fields use RDF lists, including the pairs in `trust.introductions` and
`trust.pins`. A source rule's `subjects` is an ordered IRI list or the direct
`awp:anySubject` IRI for `"any"`. Trust `claimTypes` use repeated `awp:claimType`
values. The actor keys in `termsAcceptance` identify the corresponding RDF nodes.
`ownLists`, trust `sources`, `vocabulary`, `notificationRecipients`,
`handlerImplementations` and `answeredRegisters` carry their authored keys on
`awps:key`. `answeredRegisters` indexes register IRIs directly.

Profile action claims, derivation `inputsFrom` lists and effect `adapter` fields
accept both IRIs and local names. The graph reader emits IRI values as links and
local names as literals. Labels, email addresses, digests and qualified fixture
references are textual values.

## JSON literals

The strict fixture reader treats these terms' values as opaque JSON in the indicated
scopes. The credentials context, when explicitly used, has its own pinned term definitions.

| Term | Reason |
| --- | --- |
| `actionKinds` | Map of operation IRIs to native action strings. |
| `activity` | Script value or reference to an activity. |
| `actual` | Script expression evaluated by an assertion. |
| `agreement` | Script value or reference to an agreement. |
| `agreementPlan` | Engine plan used in a receive step. |
| `answerThrough` | Script expression for the forum response interval. |
| `assurance` | The scenario-level nullable assurance flag preserves explicit JSON null. |
| `attempt` | Fixture data for a mandate-status fault. |
| `authorityChains` | Scenario map from local agents to arrays of authority-chain paths. |
| `autonomous` | Native mandate rules can contain local action names, plural constraints and payment limits. The pinned ODRL context describes a different shape. |
| `balances` | Map of currency codes to exact amount strings. |
| `basis` | Open basis object or script expression supplied to a start step. |
| `body` | Open message body supplied by a script step. |
| `bytes` | Fixture attachment payload as text or an array of octets. |
| `change` | Branch or configuration patch syntax. |
| `claims` | Open claim records under dataset rows. |
| `clauses` | Open agreement terms keyed by the clause name. |
| `contents` | Open payload of a start step. |
| `controllers` | Map from identities to controller strings. |
| `conversation` | Script value or reference to a conversation. |
| `credential` | Script value or reference to a credential. |
| `derivedEvidence` | Open evidence values and expressions supplied by a script. |
| `equals` | Open claim comparison maps in agreement and escrow conditions. |
| `exchange` | Script value or reference to a deliberation exchange. |
| `expected` | Value or expression to compare in a script assertion. |
| `from` | Open interval start expression under a witness anchor. |
| `identityNames` | Map from identity IRIs to names represented by IRIs. |
| `input` | Open invocation input supplied by a script. |
| `inputs` | Joint-session map from contributor slugs to statement-slug arrays. |
| `intent` | Open action intent, including its structured parameters. |
| `jws` | Script value or reference to a compact JWS. |
| `labels` | Maps of identifiers or dataset fields to scalar labels. |
| `message` | Open message reference in a fixture effect's origin. |
| `observation` | Script value or reference to a forum observation. |
| `observed` | Open observed receipt payload. |
| `originalDigest` | Script value or reference to the digest of read content. |
| `output` | Open output of a content reader. |
| `parameters` | Open parameters for a profile action. |
| `params` | Template-specific inputs and arbitrary fixture handler parameters. |
| `parties` | Profile map from local participant names to display strings. |
| `payload` | Open payload of a joint protocol step. |
| `profileChange` | Patch syntax applied to the profile. |
| `prohibitions` | Native mandate rule array with the same shape as `autonomous`. |
| `reference` | Script value or reference to a resource reference. |
| `references` | Quality-certificate lookup map from keys to IRI strings. |
| `reply` | Open reply parameters supplied by a script. |
| `request` | Open proof request or store request supplied by a script. |
| `requester` | Map from agent slugs to requester IRI strings. |
| `requiredRoles` | Map from operation IRIs to arrays of role labels. |
| `segment` | Script value or reference to a record segment in a forum step. |
| `sources` | Profile map from source aliases to IRI strings. |
| `standingRules` | Native standing mandate rule array with conditions, permissions and duties. |
| `status` | Open status data on a proof credential fixture. |
| `suites` | Map from suite layers to implementation strings. |
| `terminal` | Script value or reference to a terminal record proof. |
| `terms` | Open statement terms supplied by the scenario. |
| `traceSteps` | Map from step keys to display captions. |
| `value` | Open statement, signed-document fixture, injected value or script value. |
| `withApproval` | Native approval rule array with the same shape as `autonomous`. |
| `world` | Patch syntax applied to the world for a configuration. |

## Slug references

Slug references are string literals in v1. Their interpretation depends on the
containing profile, scenario or path.

- Agents and participants use `actsFor`, `agent`, `anchor`, `finisher`, `from`,
  `holder`, `host`, `issuer`, `judgedAgent`, `observer`, `party`, `peer`,
  `platform`, `proposer`, `publication`, `reader`, `requester`, `respondent`,
  `service`, `signer`, `subject`, `superior` and `witness` in their slug scopes.
  `computeOnly`, `contributors`, `introductions`, `parties`, `pins` and
  `proofOwners` contain lists of participant names in their fixture scopes.
- Steps and paths use `at`, `extends`, `onlyUnder`, `path`, `requires`, `segment`,
  `segmentEnd`, `step` and `stopAfter`. `configuration` and participant
  `configurations` name configurations. `profile` and `useCase` name the local profile
  and use case. `replaces` carries qualified local names.
- Scenario entities use `answersFor`, `grant`, `index`, `mailbox`, `register`,
  `roleStatement`, `statement` and `store` in their slug scopes. `attachments`,
  `evidence`, `records` and `statements` can list local references. `$ref` is an
  engine expression rather than an RDF identifier.
