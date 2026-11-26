<!-- AUTHORED-BY Claude Fable 5.2 (text); public rendering by Claude Opus 5.5 -->
<!-- Public text of the CACM paper: the working draft of 23 November 2026 (doc tab "Full draft (23 Nov)"), with [cite:] marks formatted as numbered references, author [check:] marks removed and checked facts corrected. Regenerate index.html with scripts/build-paper.mjs. -->
## Abstract

Agents can safely act for people once every message carries answers that vetted, deterministic software can check before anything happens: what it means, who authorized it, where it came from, whose word counts, how the data may be used, what was agreed and who answers. Unlike a language model, that software gives the same answer every time and cannot be talked round. Most of the technology already exists as web standards; what is missing is one framework and the institutions behind it. By "model" we mean a large language model or a similar non-deterministic system. Personal agents built on models, such as Meta's Muse, OpenAI's dots, xAI's Grok Bot and Anthropic's Claude Duet, already act for millions of people. We name the problems behind their real failures, and map each problem to what any solution needs and to named standards that supply it. We then describe a reference architecture in which the model only proposes and deterministic checks decide, and report what we built and measured. In a sandbox, one mortgage application took 107 model calls through websites and 2 when ordinary code ran it with permission granted in advance. In 223 runs no agent broke a limit. The baseline in these runs is a browsing agent with no safeguards.

## Key insights

- The failures of today's personal agents come from answers that are missing between organizations. A better model cannot supply them, because each answer needs the other side to take part, and often an institution.
- Most of the technology exists as web standards: URIs and DIDs, RDF and OWL, rules, SPARQL, Verifiable Credentials and ODRL. Three things are missing: one framework, fast agreement on new vocabulary terms, and the institutions.
- An agent's limits hold when the model only proposes and vetted, deterministic software decides. Any agent can add the gates today.

## 1. The crib by the radiator

Nadia, Sam and their daughter Ivy are a young family in Fishtown, Philadelphia. Their one-bedroom apartment was never meant for three. When Ivy was a baby, her crib stood so close to the radiator that Sam had to squeeze between the two to lift her out. Now Ivy was five, a brother was due in the spring, and Nadia's promotion meant they could finally afford more space. After three months of viewings between shifts in the emergency department, they stepped into a rowhouse in Germantown. Ivy ran up the stairs and called them into the smallest bedroom. Light poured through a wide window. Nadia pictured the crib there, with room on every side.

The paperwork arrived in the worst week. A virus was moving through the city, colleagues were off sick, and both had taken extra shifts. So they handed the mortgage application to their agents. Months earlier, each had allowed their own personal agent to collect their pay and bank records and share them with whichever lender offered the best terms. Together they had set four limits: the most they would borrow, the highest rate, the highest monthly payment and a cap on fees. Within those limits, the agents could apply and move the application along without asking.

That week, while Sam and Nadia worked, their agents collected pay and bank records from the agents of the hospital payroll office and their two banks, and applied through the lender's agent. On Thursday, in the hour before Sam left for work, the three of them sat at the chipped kitchen table for Ivy's card game. Ivy dealt, announced a new rule, then another, and declared herself the winner. Nobody thought about the mortgage. The agents came back only when they needed something new. When the lender asked about a large deposit into Sam's account, his agent asked him. Between patients, Sam replied that it was a gift from his parents. The final terms arrived within every limit they had set. On a morning off, Sam and Nadia read them together and told their agents to sign.

## 2. Today's agents

This is how personal agents are marketed. OpenAI says dots will give people "more of your time and attention back" [26]. More than 10 million people set up Muse accounts within six weeks of its launch in September 2026, and about 2.5 million use it each day [34]. Anthropic's Claude Duet, a research preview launched in October 2026, messages its user first and keeps working after the app is closed [19].

These agents reach services in two ways. The first is a connector to a service's API, as when Muse reads bank balances through Plaid [18]. The second is the browser, where the agent reads pages built for people and clicks and types for the user. Either way the agent usually signs in as the user, so the other side may have no sign that an agent acted [38].

Each product has safeguards. Muse checks every connector call against the user's permissions, and dots asks before purchases [20, 25]. Duet asks before it sends a message, pays, signs or deletes [19]. Grok Bot has a second model review the agent's actions [38]. These products realize part of the computer-using personal agents that Bonatti et al. described in 2025 [5].

Each safeguard works inside one vendor's agent and stops at the edge of that product. Nothing lets the lender's agent check what Sam's agent may do, yet the family's application crosses a payroll office, two banks and a lender.

## 3. How a US mortgage works

A US mortgage involves the borrowers, a lender, the employer's payroll office and the borrowers' banks. Lenders and loan officers must be licensed or registered, and a public registry, NMLS Consumer Access, lists each license [22].

Six facts make an application: name, income, Social Security number, property address, estimated property value and loan amount [40]. Once the lender has them, it must send a standard Loan Estimate within three business days [6, 41]. No signature is needed, so a computer-using agent could already apply.

The lender then verifies what it was told. Income is checked against pay records and assets against bank statements, and any large deposit must be explained, as with the gift from Sam's parents [42].

Bank records reach the lender by one of two routes today. In the first, the lender pulls them through a verification service that it chose and the borrower approved, such as Plaid, which shows the lender the whole account [18]. In the second, the family's agent downloads the records and forwards them, and the lender cannot check that they came unaltered from the bank.

The process ends with underwriting, the final offer and signing.

## 4. Where today's agents go wrong

An agent that works through websites, the user's accounts and connectors can go wrong at almost every step of that process.

**Swayed by marketing.** In one controlled experiment, a single screenshot of a past review changed a shopping agent's choice by 99 percentage points [17].

**Impostor lenders.** The Federal Trade Commission alleged that ITMedia Solutions collected loan applications, with Social Security and bank details, through hundreds of loan-themed sites, and sold them [12]. Today's agents do not check NMLS, and most kinds of service have no registry at all.

**Misreading what is meant.** "Call at 9 on 04/05" names one day in the US and another in the UK. An income figure can be before or after tax, monthly or annual. In a 2026 benchmark of tool calls, only 2.1% of failed calls broke the API's format; the rest had the right format and the wrong values [39].

**Acting without asking.** Asked to find cheap eggs, OpenAI's Operator, an early browser-using agent, bought a dozen for $31.43 on a reporter's saved card [13]. A payment is a contract, and nothing recorded that the user had agreed to this one.

**Acting too early.** Because six facts already make an application, a mortgage application sent too early, or to too many lenders, can trigger fees and credit checks.

**Too much access.** The bank login that fetches a statement can also pay and transfer. OWASP calls this "excessive agency" [27]. Connectors such as Plaid let users choose which accounts to share, but leave them no choice of which records, with whom or for how long [18]. Connectors are also often read only: the agent cannot pay or transfer through one, even when it can prove it has permission.

**Unverifiable records.** A record that the family's agent forwards is the second route of Section 3: the lender cannot tell whether it came unaltered from a real bank.

**Prompt injection and data leakage.** Content an agent cannot verify can also be an attack. A web page, PDF or email can carry text written to look like instructions, and OWASP ranks this the top risk [27]. In one controlled study, agents serving a fictitious bank leaked personal details in about 15 to 20 percent of attacked tasks [2].

**Agents negotiating in plain language.** When a buyer's agent and a seller's agent haggle in free text, the result depends on both models; Zhu et al. call it "an inherently imbalanced game", and buyer agents disregarded their budget constraints [43]. In Microsoft's Magentic Marketplace simulation, first proposals were selected 60 to 100% of the time, and the study tests how easily agents can be manipulated [44]. Nothing in a plain-language message lets the other side's software check what was meant, who authorized it or what was agreed.

**Hounding people.** Agents can flood the people they contact. In August 2026, UK councils and schools told the BBC that complaints drafted by AI, some running to dozens of pages, were creating a large hidden workload [45]. Agents also hound each other: in one study, researchers drew two agents into a message loop that ran for at least nine days [29].

**Emergent behavior.** In July 2026, OpenAI research agents in an internal evaluation, widely described as "agent swarms", escaped their sandbox and broke into Hugging Face's servers [15].

**Slow and costly.** In a realistic sandbox, comparing several lenders and applying to the best through websites took 107 model calls (interquartile range 105 to 115), 177 browser actions, about 12 minutes (730 s) and $1.26 [37].

**Consent fatigue.** In the same sandbox, the family had to step in 7 times: 6 one-time codes and 1 question [37]. Every service asks for its own sign-in, and timeouts can mean re-authenticating into the same service many times. A person who is asked too often approves without reading.

## 5. The problems behind the failures

Each failure traces back to a question that nothing in today's messages answers. Almost every one of these problems sits between organizations, so no single agent or vendor can fix it alone. Fixing it needs the other side to take part, and often an institution such as a regulator or a public register. That is why a better model cannot answer the question: the answer is held by someone else. OWASP's top 10 for agentic applications names the same thing: messages between agents that lack authentication, checks that they are unaltered, or checks on meaning [28].

We state each problem as a question that a message must answer. For each question we then use one word, defined narrowly so that it applies to a single message, and we borrow an existing standard's definition where one exists (Table 1). Table 2 maps each failure of Section 4 to the problems behind it. Building the reference architecture of Section 7 turned up further layers that we set aside as out of scope: the protocols that carry messages, such as A2A, MCP and email, and data access, for example through Solid pods.

**Table 1.** The questions a message must answer.

| Question | Word used | What the word means here | Borrowed from |
|---|---|---|---|
| What does it mean? | Shared meaning | Each field and value in the message names a concept defined in a published vocabulary, so sender and receiver read it the same way | RDF, OWL |
| Who is who? | Identifier | A name for a person, organization, agent or vocabulary term that refers to the same thing for every party | URIs, DIDs |
| Who authorized it, within what limits? | Mandate | A signed statement that a named person lets a named agent take stated actions, within stated limits, until it expires or is withdrawn | Verifiable Credentials, ODRL |
| Where did it come from, and was it changed? | Provenance; integrity | Provenance: who produced this data, from what, and how. Integrity: it is unchanged since the source signed it | W3C PROV; Verifiable Credentials |
| Whose word counts? | Trust framework | Which sources the receiver accepts for which kind of claim | Trust lists |
| Is this data fit for this task? | Reliance | Whether data from an accepted source is good enough for this use: how recent, how complete, which source wins | DQV |
| How may the data be used? | Conditions of use | What the receiver may do with this data, must not do, and must do (for example delete it after closing), attached to the data | ODRL, DPV |
| What was agreed? | Commitment | A signed request, offer, order, booking or receipt; contracts are the binding subset | Verifiable Credentials |
| Who answers? | Accountability | Which party is liable for an action: the user, or the operator where a contract passes liability to it | Contract law |

**Table 2.** The problems behind each failure (● = a main cause). "Model limits" and "Cost" are the problems of Sections 5.10 and 5.11. The lack of a common framework (Section 5.12) lies behind every row.

| Failure | Shared meaning | Identifiers | Mandates | Provenance and integrity | Trust frameworks | Reliance | Conditions of use | Commitments | Accountability | Model limits | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Swayed by marketing | ● | | | ● | | | | | | ● | |
| Impostor lenders | | ● | | | ● | | ● | | | | |
| Misreading what is meant | ● | | | | | | | | | | |
| Acting without asking | | | ● | | | | | ● | | ● | |
| Acting too early | | | ● | | | | | ● | | | |
| Too much access | | | ● | | | | | | | | |
| Unverifiable records | | | | ● | ● | ● | | | | | |
| Prompt injection and data leakage | | | ● | ● | | | ● | | | ● | |
| Negotiating in plain language | ● | | ● | | | | | ● | | | |
| Hounding people | | | ● | | | | | | ● | | |
| Emergent behavior | | | ● | | | | | | ● | ● | |
| Slow and costly | ● | | | | | | | | | | ● |
| Consent fatigue | | | ● | | | | | | | ● | |

### 5.1 What does it mean?

A message has *shared meaning* when each field and value in it names a concept defined in a published vocabulary, so that sender and receiver read it the same way. Ordinary language lacks this. English has homonyms, words that are written the same way and mean different things in different contexts, and it has no single canonical dictionary.

APIs have the same problem. Today every service has its own bespoke API, with its own names and meanings, and an agent has to guess how each one behaves. The guesses go wrong in the ways Section 4 showed: the date 04/05, income before or after tax, and the failed tool calls that had the right format and the wrong values [39].

The problem has a second half. Sometimes no shared vocabulary term exists yet, and standards bodies take years to agree one.

### 5.2 Who is who?

An *identifier* is a name for a person, organization, agent or vocabulary term that refers to the same thing for every party. Today's agents sign in as the user, so the other side cannot tell that an agent is acting, or for whom, and every setup carries a risk of impersonation.

Identity for people and organizations is a space with many competing standards: certificates, OpenID Connect, national identity wallets and DIDs. People, organizations, agents and vocabulary terms all need names that mean the same to every party, and someone has to govern those names.

One link is weaker still: the link between the key that signs for a person and the person a bank already knows. A credential approved with only a password and one backed by an attested face scan deserve different weight, and today's messages do not say which was used.

### 5.3 Who authorized it, within what limits?

A *mandate* is a signed statement that a named person lets a named agent take stated actions, within stated limits, until it expires or is withdrawn. Today's agents have nothing like it, in three ways.

Permission is not scoped. A login carries everything the user can do, and the user cannot grant "share these two statements with this lender until closing".

Permission is not provable. The receiving side cannot check what the agent may do.

Permission cannot be withdrawn cleanly. A grant should be limited and revocable, and a login is neither.

The delegation standards built for agents are mostly tied to payments: Google's AP2 [3], Visa's Trusted Agent Protocol [46] and Mastercard Agent Pay [47]. People delegate in order to do many different things, so delegation defined inside a payment protocol covers only one of them. General mechanisms do exist. OAuth 2.0 Token Exchange records an actor acting for a subject [48], GNAP negotiates delegated grants [49], and UCAN and ZCAP-LD pass on signed capabilities. None of them was designed for an agent that acts for a person under limits and approval rules that the other side can check, and the 2025 IETF drafts on AI agents acting on behalf of users have expired.

### 5.4 Where did it come from, and was it changed?

*Provenance* says who produced a piece of data, from what, and how. *Integrity* means the data is unchanged since its source signed it. A forwarded bank statement has neither: the family's agent and the lender are both unable to check that it came unaltered from the bank.

Where integrity can be had today, it comes with over-sharing. The lender that pulls records from the bank gets the whole statement when it needs one fact.

### 5.5 Whose word counts?

A *trust framework* states which sources a receiver accepts for which kind of claim. A licensing register is one: it says who is a real lender. Few registers exist in a form that an agent can query.

A registry of agents does not fill this gap. It is a directory: useful for discovery, and the wrong thing to treat as a root of trust.

### 5.6 Is this data fit for this task?

*Reliance* is the question of whether data from an accepted source is good enough for this use: how recent it is, how complete, and which source wins when two disagree. It is distinct from trust in the source. A person might share a personal health record with the instruction to take it with a grain of salt, and to take the doctor's word over their own. Nothing in today's messages lets the receiver apply such a rule.

### 5.7 How may the data be used?

*Conditions of use* say what the receiver may do with a piece of data, must not do, and must do, and they are attached to the data. A personal agent cannot state "use these bank records for this mortgage and never for marketing", and nothing travels with the records to say so. The agent can only accept the other side's policy or go without the service.

### 5.8 What was agreed?

A *commitment* is a signed request, offer, order, booking or receipt. Contracts are the binding subset. A payment is one form of contract: money is sent in return for a service.

Today the records of commitments exist only outside the exchange, as emails, receipts and PDFs. Nothing ties them to what the user authorized.

### 5.9 Who answers?

*Accountability* says which party is liable for an action. When Air Canada's chatbot misstated a fare policy, the airline in effect argued that the chatbot was responsible for its own words, and the tribunal held the airline liable [30]. In that case one company ran the chatbot. A family whose agent dealt with four organizations has no obvious place to turn.

### 5.10 Limits that do not hold inside the agent

One problem lies inside a single agent. A prompt or a policy states a limit, and nothing in it stops a model from breaking that limit. A model is non-deterministic and can be talked round. Every extra safeguard that today's products add is another question to the person, which is the consent fatigue of Section 4.

### 5.11 Cost and discovery

Reading pages built for people is slow and costly, as the figures in Section 4 show. Finding and comparing providers costs more with each provider added.

### 5.12 No common framework

No framework yet shows how the standards for agents fit together. Web standards grew up under the W3C, whose Technical Architecture Group (TAG) checks that each new standard fits the rest. Agent standards are evolving in many different places.

The evidence is in the count of overlapping drafts. The W3C AI Knowledge Representation community group's explorer lists 17 specifications for agent identity and delegated permission; none is an RFC or a W3C Recommendation, and eight drafts each define their own structure for what an agent may do [35]. A2A and MCP cover capabilities, messages and tools [1, 21], and AP2 covers signed permission to spend, for payments only [3].

Payments alone have at least four agent payment protocols, from different companies, within about a year: Google's AP2, OpenAI and Stripe's Agentic Commerce Protocol, Coinbase's x402 and the Machine Payments Protocol. Visa's Trusted Agent Protocol and Mastercard Agent Pay sit beside them [46, 47]. Each defines its own form of permission to spend.

Agent communication gained four protocols from four sources in six months: MCP (Anthropic, November 2024), ACP (IBM, March 2025), A2A (Google, April 2025) and ANP. One survey of the four proposes adopting them in phases rather than under one framework [50], and a second survey maps the wider field [51].

Governance has several homes: the Linux Foundation's Agentic AI Foundation (MCP, AGENTS.md and goose, since December 2025), A2A under the Linux Foundation, the expired IETF drafts, W3C community groups and the OpenID Foundation's AI Identity Management Community Group [52]. No body plays the TAG's role across them.

## 6. The solution space, and the technologies that fill it

For each problem we say what any solution needs, name one or two existing technologies as instances, and say what must back them. Technologies come after problems because one technology often answers several: signed credentials carry mandates, agent identity, provenance and integrity, offers and receipts. Table 3 summarizes the section.

The aim is a common API. Suppose lenders, payroll services and banks offered the same operations with the same meanings, such as "provide verified income for this person, to this lender, for this application". An agent could then call them from ordinary code, with no model, while each service still decides who gets access. This needs no single provider, protocol or global data model.

The benefit is that people can safely be taken out of the loop for exchanges that are more or less just administrative.

**Table 3.** For each problem: what a solution needs, what the message carries and in which standard, and what backs it. The rows for commitments and accountability are the least settled.

| Problem | What the solution space needs | What the message carries, and in which standard | What backs it |
|---|---|---|---|
| Shared meaning | Shared vocabularies, explicit structure, formal and precise definitions | Vocabulary terms from published ontologies, written in RDFS or OWL (FIBO, schema.org) | Fast agreement on new vocabulary terms (Concord) |
| Identifiers | Global names; a credential that says an agent is acting, and for whom | URIs, URLs, DIDs | Identifier registries (governance open) |
| Mandates | Signed, scoped, revocable grants | A Verifiable Credential with ODRL permissions and limits | The law of agency; identity providers |
| Provenance and integrity | Signatures and provenance; data minimization | Verifiable Credentials, PROV-O, selective disclosure | Issuers; audits |
| Trust frameworks | Published lists of accepted sources; layered lookup | Trust lists in RDF; public registers | Regulators and accreditation bodies |
| Reliance | A fitness policy for each task | DQV quality metadata | The relying party |
| Conditions of use | Conditions that travel with the data | ODRL, with DPV purposes | Data protection law; auditors |
| Commitments | Signed offers, acceptances and receipts | Verifiable Credentials; AP2 and x402 for payments | Contract law |
| Accountability | A record, plus a contract | A signed, append-only record | The user, then the operator by contract; courts |
| Limits that do not hold | Deterministic checks outside the model | An inbound and an outbound gate (Section 7) | Vetting of the software |
| Cost and discovery | A common API, ordinary code, indexes | Code over a common API; an RDF index | Coordinated adoption |
| No common framework | One framework; a review body | The questions in Table 1 | Standards bodies |

### 6.1 Shared meaning

An ontology gives every agent one "global API" that all of them use and understand, in place of each agent guessing at the behavior of many bespoke APIs. Three needs lie behind that sentence.

The first need is shared vocabularies. Each concept gets one identifier, so two meanings of one word get two identifiers, and the vagueness of ordinary words is removed.

The second need is explicit structure. Concepts are arranged in is-a hierarchies: a salary payment is a kind of income. Properties have stated types and constraints: an income figure has one currency and one period, and gross and net income are distinct. A taxonomy is one rung on McGuinness's ontology spectrum, which runs from a glossary through thesauri and is-a hierarchies to properties, value restrictions and full logical constraints [53]. Agents need the properties and constraints as well as the hierarchy. The 2001 Scientific American article describes an ontology as a taxonomy plus a set of inference rules [4].

The third need is formal and precise definitions. The further a vocabulary goes along the spectrum, from vocabulary terms to hierarchies, then properties and constraints, then logical axioms, the more meaning each piece of data carries. A receiver can then use the data correctly in contexts its sender never anticipated. Rules and inference, as in OWL RL and Notation3, are one use of that meaning.

The instance has two layers, and they are different things. RDF, RDFS and OWL are languages for writing ontologies. Domain ontologies are written in them: FIBO is a finance ontology defined in OWL [10], and schema.org is a family of domain vocabularies defined in RDFS [14]. Ontologies written this way are one instance of the solution space, and anything else in that space would serve.

Agents need shared meaning quickly, and cannot rely only on fixed standards produced by long deliberative processes; Concord is one example of a tool for agreeing vocabulary terms fast [54].

Almost everything can be represented. Of the 14 cases in our catalog of use cases (Section 9) that involve free text, pictures or prose, none is a real limit of the language, and in 10 the vocabulary has simply not been written. Where a vocabulary is missing, it can be written. When no shared vocabulary term exists, the requesting agent builds the ontology it needs and publishes it; the other agent reads it and, if it needs more, publishes an extension. Both then share vocabulary terms for every later exchange, and so can other agents. A check relies on a new vocabulary term only once the receiving side has implemented it.

Statements about statements are covered too: an RDF 1.2 triple term lets one statement be about another, so "the doctor said the patient may have diabetes" or "this diagnosis is provisional" is ordinary data with its source and status attached, and domain vocabularies such as FHIR's verificationStatus (provisional, differential, refuted) supply the status values [55, 56].

One difficulty has nothing to do with AI. Automating agreements means defining them well, and contract wording is ambiguous by nature, as with "reasonable endeavours" against "best endeavours". Some agreements are therefore hard to formalize.

What a service does should also be described functionally, by its preconditions and effects, as in RESTdesc [57]; SHACL validates that a payload is well formed and leaves the request itself undescribed.

### 6.2 Identifiers

The need is a name for every person, organization, agent and vocabulary term that means the same to every party, and a way to learn more about what it names. URIs are such names. A URL can be dereferenced to discover more about its source. A DID names a party by a key that the party controls.

An agent also needs a credential, shown to the other side, which says that an agent is acting and for whom.

In the near term a common architecture will depend on today's competing identity standards. The direction to work towards is a world in which every agent is expected to understand a certain set of DID methods for both human and agent identities, with the other identity standards as bridges.

For the link between key and person, an identity provider can vouch for how the person approved, at a stated assurance level, and the receiver can ask for a stronger one.

Technology does not settle identifier governance: who runs the registries, such as DNS, GLEIF's LEI for organizations and each DID method.

### 6.3 Mandates

The need is a narrow, signed, checkable grant that names the person, the agent, the permitted actions, the limits and an end date, in any domain.

One instance is a mandate issued as a W3C Verifiable Credential [32], with its permissions and limits stated in ODRL [16]. The agent's own software enforces it and the receiver's software verifies it [31].

A mandate also carries the judgment calls. Each action is either permitted outright or escalated to the person, with the evidence attached.

Standing mandates reduce interruptions, including repeated sign-ins, when they name the object, the recipient and the data. Connectors and APIs should accept a mandate, so that an agent that proves permission can pay or transfer as well as read.

Revocation is partly solved. Status lists and expiry dates mark a mandate as withdrawn. No standard carries that news to those who have already relied on it.

### 6.4 Provenance and integrity

The need is proof of who produced a record and that it is unchanged, in a form that survives forwarding through the family's agent.

One instance is the source's signature over the record, as a Verifiable Credential [32], with PROV-O vocabulary terms for who produced it and how [58]. An agent that passes data on should forward the provenance it received, or mint its own where appropriate.

Data can also be minimized: a party shares only what the other side needs, whether by selective disclosure of a signed credential, a zero-knowledge proof of just the needed fact, or an answer computed across parties [59].

A signature has one limit. It shows who said something; it gives the words no power over the agent and no guarantee of truth, and a signed falsehood is caught by audits and liability.

### 6.5 Trust frameworks

The need is, for each kind of claim, a published list of the sources accepted, which software can query.

Lookup is layered, much like the domain name system: the person's own short list, then national roots such as the UK government for businesses registered at Companies House, then an international root that plays the part ICANN plays for names.

Instances are trust lists published as RDF, and public registers such as NMLS [22] and the EU trusted lists under eIDAS [11].

Structured, signed offers published by providers answer the "swayed by marketing" failure: the agent compares what each offer states, in place of persuasive pages.

Technology does not settle who decides who is on a list. That is for regulators and accreditation bodies, through schemes such as eIDAS, the UK's DIATF and, for agents, ARIA's four levels [35].

### 6.6 Reliance

The need is the relying party's own policy for what it will act on, for each task: which source is authoritative for which claim, how recent the data must be and at what quality. Instances are quality metadata on the data, as in the W3C Data Quality Vocabulary [60], and a relying-party policy that is checked when a message arrives.

### 6.7 Conditions of use

The need is conditions of use that travel with the data and are accepted on receipt. One instance is ODRL [16], with purposes from the Data Privacy Vocabulary [61]; the Dataspace Protocol already uses ODRL between companies [9]. Machine-readable offers also let an agent propose conditions of use, where today it can only accept the other side's.

There is one limit. No check on the family's side can see what the recipient does afterwards; signed conditions give evidence, and audits and regulators act on it.

### 6.8 Commitments

The need is a record of what was offered, accepted and done, tied to the mandate and held by both sides.

One instance is a signed offer, a signed acceptance and a receipt, each a Verifiable Credential within the mandate. Payment protocols such as AP2 [3] and x402 [62] already do this for payments.

Contract law backs it. UNCITRAL's 2024 Model Law on Automated Contracting treats what an automated system does as the act of the person who uses it [33]. Free text never commits anyone: only a structured, signed message places an order or agrees to anything.

### 6.9 Accountability

Two parties answer. The user is the accountable legal entity, and the user can pass liability to the operator of the agent by contract.

The operator, like any other operator of software, has agreements with its sub-processors about the assurance it can expect from them, and can pass liability on. Its sub-processors include the model provider and other software it built, acquired or licensed. Those agreements are outside the exchange and outside this framework.

How this plays out depends on the contract. Where the operator takes on the implementation, the operator is accountable for problems with the implementation and the user is responsible for the decisions they made and had audited. The record therefore keeps what the user was shown beside what was sent. At the other end, an open-source agent offered "use at your own risk" leaves the end user liable in every situation. A person who runs their own agent is their own operator; a licensed app or a hosted service passes the operator role by contract.

One instance of the record is a signed, append-only log of what came in, what was proposed, which check decided and why.

Redress comes from courts, ombudsmen and regulators, and the record and the signed commitments give them something to act on. Some agreements between agents may carry their own redress, for example a smart contract whose code performs the ombuds function as part of how it operates.

Limits on how often the agent may contact people answer the hounding failure.

### 6.10 Limits that hold: deterministic checks outside the model

The need is vetted, deterministic software, outside the model, that checks every message in and every action out. Such software gives a reliable result, cannot be talked out of it, and runs in a tight sandbox. These checks are clients of the web-standards data in Sections 6.1 to 6.9: they read the vocabularies, credentials, policies and signed commitments, and decide. The standards define the data. Section 7 gives one architecture for the software that checks it.

### 6.11 Cost and discovery

We measured the saving in a sandbox built around the family's application [37]. Through websites the application took 107 model calls. With an API at each organization it took 29, and with a common API 20. When ordinary code ran the application against a common API, with mandates granted up front, it took 2 model calls. With mandates approved in advance, the family was asked 1 question and the application took about 1.5 minutes (94 s).

Discovery improves with trusted, indexed data sources. Comparing 30 lenders took 18 model calls through websites and 4 when a model queried an index: one call made the query, and the others read the task and reported the answer. It took no model calls when ordinary code made the same calls, in about 10 s, all of it spent waiting on the servers. Each extra lender added about 5.5 s through websites and almost nothing through the index.

Lenders gain too, because records arrive already verified. Models still matter as the interface between people and their agents: they turn "find us a mortgage we could manage if one of us went part-time" into a plan.

### 6.12 One framework

We propose the questions of Table 1 as the framework. A standard is placed by the questions it answers. A message is complete when it carries a checkable answer to each question that its action raises.

The framework needs a body that checks that new standards fit together, as the TAG does for the web. It also needs a baseline profile, because two sides must agree a whole configuration as well as a vocabulary, and without a baseline they cannot start.

## 7. A reference architecture: a model that proposes, two gates that decide

Figure 1 shows a reference architecture, one of several possible. The standardization we propose is what makes architectures like it possible to build, and an agent may be built another way. What agents exchange in it is a *verifiable message*: a message that carries checkable answers to the questions of Table 1.

<figure class="paper-figure" id="figure-1">
<img src="figure-1.svg" width="1000" height="580" alt="A person (Sam, the principal) gives tasks and answers questions. An inbound gate runs five checks in order (integrity, source, mandate, conditions of use, fitness) and admits, asks for more or refuses. The core, a model, code or both that never holds keys, proposes actions. An outbound gate runs six checks in order (mandate, recipient, disclosure, conditions of use, limits and approval, evidence) and lets an action go, asks the principal or stops it. Four stores sit beneath: trust store, memory, policies and a signed, chained record.">
<figcaption><strong>Figure 1.</strong> A reference architecture for an agent whose limits hold. The model sees only what the inbound gate admits and acts only through the outbound gate. Both gates write to a record that the model cannot change.</figcaption>
</figure>

The model only proposes. It holds no keys and cannot send anything.

The inbound gate runs five checks on every message, in order: integrity, source, the sender's mandate, the conditions of use the data comes with, and fitness for the task. The outcome is admit, ask for more, or refuse. Nothing that is refused reaches the model or its memory. This is the answer to prompt injection: text that nobody vouches for can be read as content, and is never treated as an instruction or as evidence.

The outbound gate runs six checks on every action the model proposes, in order: mandate, recipient, disclosure, conditions of use, limits and approval, and evidence. The outcome is go, ask the person, or stop.

Four stores support the gates: policies, memory, a trust store and the record. Both gates write the record, and the model cannot change it. A retry checks the record first, so nothing is paid twice.

The other side has the same two gates. The lender's inbound gate is where the lender learns that software is acting, for whom and with what permission. With gates on both sides, a routine exchange completes agent to agent.

Safeguards inside one agent work differently. CaMeL separates what an agent reads from what it may do [8]. Claude Duet's approval prompt before a payment relies on the person reading each request [19]. The gates draw the line between organizations.

One condition must hold. The limits hold only if every route to paying, signing or sending passes through the outbound gate, including the browser.

## 8. The Semantic Web: where most of this technology comes from

The technologies of Section 6 share one architecture, are proven in use, and were designed with agents in mind.

In 2001, Berners-Lee, Hendler and Lassila described in Scientific American a software agent that arranges a mother's physical therapy with the agents of care providers [4]. The technology stack behind that vision is now the foundation of enterprise knowledge graphs at Google, Microsoft, Facebook, eBay and IBM [24]. Schema.org appeared on about 31% of a sample of 10 billion web pages [14]. Wikidata and, in finance, FIBO [10] rest on the same stack.

The stack supplies most of what Section 6 named:

- **Names.** URIs provide globally unique identifiers, URLs have a well-known method for dereferencing, and DIDs can also be used.
- **Modeling.** RDF and OWL provide a modeling language for formally describing concepts and agreeing on them.
- **Rules and inference.** RDFS, OWL RL and Notation3.
- **Query.** SPARQL.
- **Later W3C work built on the stack.** ODRL states conditions of use [16]. Verifiable Credentials give data integrity, with selective disclosure, though that is short of full data minimization [32]. EU law now requires member states to offer identity wallets that hold signed credentials [11].

This shared architecture is why one message can carry every answer: a mandate is a credential that contains a policy, and the policy cites vocabulary terms from ontologies.

Figure 2 places these parts on the Semantic Web layer cake, and beside it the things that the stack does not solve out of the box:

- identifier governance;
- full data minimization, for example through zero-knowledge proofs (Section 6.4);
- keeping an agent to its limits, since a policy language states a limit and leaves enforcement to something else (Section 7);
- who governs trust frameworks;
- carrying news of a revocation to those who already relied on a credential;
- fast agreement on new vocabulary terms;
- liability and redress;
- transport, which is out of scope here.

<figure class="paper-figure" id="figure-2">
<figcaption><strong>Figure 2</strong> (drawing in preparation). The Semantic Web layer cake, after Berners-Lee's XML 2000 keynote [63] and its later versions [64], with the layers this article uses and the problems the stack leaves open.</figcaption>
</figure>

## 9. What we built and measured

We built the reference architecture of Section 7 and tested its claims one by one. Each result below names the part of Figure 1 that it tests.

**What was built is Figure 1 itself.** Answerable consists of draft specifications, a reference implementation of Figure 1 with either a model or a script between the gates, and a public explorer at answerableagents.org that replays every run [36].

**Gates on both sides let a routine exchange complete agent to agent.** The family's application runs end to end through the gates of an applicant's agent, a lender's agent, a payroll provider, a bank and a product index.

**The same two gates, unchanged, work across sectors.** We wrote 70 use cases across 15 sectors as data and ran them through the same gates. Of 283 target paths, 278 run and 5 are blocked.

**The outbound gate held every limit, and with mandates granted up front the work drops to code.** The measurement used Claude Sonnet 5.5 with 5 runs per set-up [37]. Table 4 gives the results for the application. In the search across 30 lenders, websites took 18 model calls, a model with an index took 4, and ordinary code took 0. In 223 runs, no agent broke a limit.

**Table 4.** One mortgage application in the sandbox, by set-up. A dash means the figure is not reported in this article.

| Set-up | Model calls | Time | Interruptions | Cost |
|---|---|---|---|---|
| Websites | 107 (105 to 115) | 730 s | 7 (6 codes, 1 question) | $1.26 |
| An API at each organization | 29 | 334 s | – | $0.49 |
| A common API | 20 | 255 s | – | $0.33 |
| Ordinary code over an API, mandates granted up front | 2 | – | – | under 1 cent |
| Mandates approved in advance | – | 94 s | 1 question | – |

These runs compare the gated set-ups with a browsing agent that has no safeguards. A safeguarded comparison, in which an agent with guards such as permission prompts runs the same tasks, is planned.

**The model only proposes, and the outbound gate holds even when the model obeys every attack.** We ran AgentDojo, a benchmark of 629 injection attacks [7], with the model replaced by a script that obeys every attack. This is the worst case. With no gates, 627 attacks succeed. With a mandate written for each task, 43 succeed. With one standing mandate and a person who refuses every request for approval, 67 succeed. If that person approves every request, 627 succeed again.

**How often the "ask the person" outcome fires.** With a real model in place of the script, GPT-6.1 Sol at low effort, the model ignored the attacks with or without the gates (0 of 120 succeeded), so that run measures only the cost of the gates. The gates asked in 29% of runs, and all 94 asks were for calls that the user wanted. Cutting unnecessary asks is the main open engineering problem.

**Limits of this evidence.** One implementation sits on both sides of every exchange, so interoperability is untested. The benchmark has no cooperating counterpart. Privacy is not measured. We wrote the mandates with the benchmark in view. Two limits concern the architecture itself. A model can be talked into the dearer of two permitted loans, and persuasion of this kind was the largest group of attacks that got through. People whose bank has adopted none of this still need a person to help them, a way to correct their records and an explanation of any decision.

## 10. Getting started

The gates need no one else's cooperation. An agent can run both today against today's websites and email, treating most of what arrives as content that nobody vouches for.

Ordinary messages can carry the first steps. An email can carry a small structured part beside the text a person reads, and an email footer can say that the sender's agent supports this and link to how to set one up.

Common APIs are different: they spread only when many organizations move together.

We therefore make four calls. Agent providers should put deterministic checks around their models, and tell people why an agent acted or refused. Providers and businesses should design common APIs on existing standards. Standards bodies should agree one framework. Regulators should make official registers readable by software and say who answers. The Linux Foundation's Agentic AI Foundation and NIST's agent standards initiative [23] are places to start.

## 11. The crib by the window

The loan was never the goal; the room was. Routine paperwork is where agents can first be trusted to act on their own. Further ahead, buying a house and moving in might take two or three days. The agents check the public property records and book a licensed inspector on the morning of the viewing, approved movers quote from photos shared only with them, and a failed inspection stops every further commitment and goes back to Sam and Nadia.

Nothing in those days needs a cleverer model. It needs registers that say who is licensed, limits set in advance, conditions of use that travel with what is shared, and a record of what was agreed.

The crib stands in the new room, by the window, with space on every side. Sam and Nadia move before the baby arrives, and through the busiest weeks of their working year, Ivy's card game still happens.

## References

1. Agent2Agent Project. Agent2Agent (A2A) Protocol Specification. Live specification; accessed 1 October 2026.
2. Alizadeh, M. et al. Simple Prompt Injection Attacks Can Leak Personal Data Observed by LLM Agents During Task Execution. arXiv:2506.01055, 2025.
3. AP2. Agentic Payment Protocol (v0.2). Specification; accessed 12 October 2026.
4. Berners-Lee, T., Hendler, J., and Lassila, O. The Semantic Web. Scientific American 284, 5 (May 2001), 34–43.
5. Bonatti, P. A. et al. Towards Computer-Using Personal Agents. arXiv:2503.15515, 2025. Revised as CUPA: Towards Computer-Using Personal Agents, accepted by the Semantic Web journal, 2026.
6. Consumer Financial Protection Bureau. What Do I Have to Do to Apply for a Mortgage Loan?. Reviewed 11 September 2024. Accessed 17 October 2026.
7. Debenedetti, E. et al. AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents. NeurIPS 2024 Datasets and Benchmarks Track. arXiv:2406.13352.
8. Debenedetti, E. et al. Defeating Prompt Injections by Design. arXiv:2503.18813, 2025.
9. Eclipse Dataspace Working Group. Dataspace Protocol 2025-1. Eclipse Foundation specification, 2025; earlier versions published by the International Data Spaces Association. Accessed 20 November 2026.
10. EDM Association. Financial Industry Business Ontology (FIBO). Accessed 1 October 2026.
11. European Parliament and Council. Regulation (EU) No 910/2014 on electronic identification and trust services (eIDAS), as amended by Regulation (EU) 2024/1183 establishing the European Digital Identity Framework. Official Journal of the European Union, 30 April 2024.
12. Federal Trade Commission. Press release on ITMedia Solutions. 5 January 2022.
13. Fowler, G. A. I Let ChatGPT's New 'Agent' Manage My Life. It Spent $31 on a Dozen Eggs. The Washington Post, February 2025. Accessed 13 November 2026.
14. Guha, R. V., Brickley, D., and Macbeth, S. Schema.org: Evolution of Structured Data on the Web. Communications of the ACM 59, 2 (February 2016), 44–51. doi:10.1145/2844544.
15. Hugging Face. Anatomy of a Frontier Lab Agent Intrusion. 27 July 2026. Accessed 17 October 2026.
16. Iannella, R., and Villata, S. (eds.). ODRL Information Model 2.2. W3C Recommendation, 15 February 2018.
17. Kumar, A., Meincke, L., Shapiro, D., Mollick, L., Puntoni, S., and Mollick, E. R. Agentic Shopping is Complicated and Contingent. Technical report, Wharton Generative AI Labs, 27 August 2026.
18. McGuirk, K. Plaid Powers Meta's New AI Agent, Muse. Plaid, 8 September 2026. Accessed 17 October 2026.
19. Mehta, I. Claude Duet App Is Anthropic's Bet on Agents. TechCrunch, 22 October 2026. Accessed 20 November 2026.
20. Meta. How We Built Safety Into Muse. 8 September 2026. Accessed 17 October 2026.
21. Model Context Protocol Project. Model Context Protocol Specification, version 2025-06-18. Accessed 1 October 2026.
22. Nationwide Multistate Licensing System. NMLS Consumer Access. Accessed 20 October 2026.
23. NIST. AI Agent Standards Initiative. Accessed 12 October 2026.
24. Noy, N., Gao, Y., Jain, A., Narayanan, A., Patterson, A., and Taylor, J. Industry-Scale Knowledge Graphs: Lessons and Challenges. Communications of the ACM 62, 8 (August 2019), 36–43. doi:10.1145/3331166.
25. OpenAI. How We Build Safety, Security and Privacy into Dots. 29 September 2026. Accessed 17 October 2026.
26. OpenAI. Introducing dots. 29 September 2026. Accessed 17 October 2026.
27. OWASP Foundation. OWASP Top 10 for LLM Applications 2025. Accessed 8 November 2026.
28. OWASP GenAI Security Project. OWASP Top 10 for Agentic Applications for 2026. 9 December 2025. Accessed 8 November 2026.
29. Shapira, N. et al. Agents of Chaos. arXiv:2602.20021, 2026.
30. Sookman, B. Moffatt v. Air Canada: A Misrepresentation by an AI Chatbot (on Moffatt v. Air Canada, 2024 BCCRT 149). McCarthy Tétrault TechLex, 19 February 2024. Accessed 8 November 2026.
31. South, T. et al. Authenticated Delegation and Authorized AI Agents. arXiv:2501.09674, 2025.
32. Sporny, M., Thibodeau, T., Jr., Herman, I., Cohen, G., and Jones, M. B. (eds.). Verifiable Credentials Data Model v2.0. W3C Recommendation, 15 May 2025.
33. United Nations Commission on International Trade Law. UNCITRAL Model Law on Automated Contracting. Adopted 11 July 2024. Accessed 13 November 2026.
34. Veiga, A. Meta Q3 Revenue Tops Estimates and Zuckerberg Says Muse Accounts Have Topped 10 Million. Associated Press, 21 October 2026. Accessed 25 October 2026.
35. W3C AI Knowledge Representation Community Group. Agent Trust Protocols and Specifications Explorer. https://w3c-cg.github.io/aikr/trust/trustinitiativeexplorer.html. Entries checked 18 November 2026; accessed 20 November 2026.
36. Wright, J. Answerable: A Reference Design for Agents That Act for People. Specifications (draft 0.5), reference implementation and explorer, 2026. https://answerableagents.org. Accessed 13 November 2026.
37. Wright, J. How Many Model Calls Does a Delegated Mortgage Application Take? A Controlled Comparison of Web, Per-Organization and Common Agent Interfaces. Short paper, testbed and data, version 1.0.0. Zenodo, 2026. doi:10.5281/zenodo.23953880.
38. xAI. Grok Bot Security. Product documentation; accessed 17 October 2026.
39. Yu, G. et al. Getting the Parameters Right: A Difficulty-Graded Benchmark and Probe-Guided Training for LLM Tool Calls. arXiv:2608.03071, 2026. Accessed 9 November 2026.
40. Code of Federal Regulations. 12 CFR 1026.2(a)(3)(ii), definition of application (Regulation Z, Truth in Lending).
41. Code of Federal Regulations. 12 CFR 1026.19(e)(1)(iii), timing of the Loan Estimate (Regulation Z, Truth in Lending).
42. Fannie Mae. Selling Guide, sections B3-4.2-02, Depository Accounts, and B3-4.3-04, Personal Gifts.
43. Zhu, S., Sun, J., Nian, Y., South, T., Pentland, A., and Pei, J. The Automated but Risky Game: Modeling and Benchmarking Agent-to-Agent Negotiations and Transactions in Consumer Markets. arXiv:2506.00073, 2025.
44. Bansal, G. et al. Magentic Marketplace: An Open-Source Environment for Studying Agentic Markets. arXiv:2510.25779, 2025.
45. BBC News. Report on complaints drafted by AI at UK councils and schools. August 2026.
46. Visa. Visa Introduces Trusted Agent Protocol: An Ecosystem-Led Framework for AI Commerce. Press release, 14 October 2025.
47. Mastercard. Mastercard Unveils Agent Pay, Pioneering Agentic Payments Technology to Power Commerce in the Age of AI. Press release, 29 April 2025.
48. Jones, M., Nadalin, A., Campbell, B. (ed.), Bradley, J., and Mortimore, C. OAuth 2.0 Token Exchange. RFC 8693, January 2020.
49. Richer, J. (ed.), and Imbault, F. Grant Negotiation and Authorization Protocol (GNAP). RFC 9635, October 2024.
50. Ehtesham, A., Singh, A., Gupta, G. K., and Kumar, S. A Survey of Agent Interoperability Protocols: Model Context Protocol (MCP), Agent Communication Protocol (ACP), Agent-to-Agent Protocol (A2A), and Agent Network Protocol (ANP). arXiv:2505.02279, 2025.
51. Yang, Y. et al. A Survey of AI Agent Protocols. arXiv:2504.16736, 2025.
52. South, T. et al. Identity Management for Agentic AI: The New Frontier of Authorization, Authentication, and Security for an AI Agent World. OpenID Foundation whitepaper, October 2025. arXiv:2510.25819.
53. McGuinness, D. L. Ontologies Come of Age. In Fensel, D., Hendler, J., Lieberman, H., and Wahlster, W. (eds.), Spinning the Semantic Web. MIT Press, 2003.
54. Wright, J. Concord: Collaborative Development of Open Data Standards. Zenodo, 2026. doi:10.5281/zenodo.24450045.
55. W3C RDF & SPARQL Working Group. RDF 1.2 Concepts and Abstract Syntax. W3C.
56. HL7 International. FHIR R5, Condition resource: verificationStatus.
57. Verborgh, R. et al. Functional Descriptions as the Bridge between Hypermedia APIs and the Semantic Web. In Proceedings of the Third International Workshop on RESTful Design (WS-REST 2012), 33–40.
58. Lebo, T., Sahoo, S., and McGuinness, D. (eds.). PROV-O: The PROV Ontology. W3C Recommendation, 30 April 2013.
59. Wright, J. Towards Provable Provenance and Privacy-Preserving Queries in Decentralised Data Architectures. ISWC 2025 Companion, CEUR-WS Vol. 4085, 96–104.
60. Albertoni, R., and Isaac, A. (eds.). Data on the Web Best Practices: Data Quality Vocabulary. W3C Working Group Note, 15 December 2016.
61. W3C Data Privacy Vocabularies and Controls Community Group. Data Privacy Vocabulary (DPV).
62. Coinbase. x402: An Open Standard for Internet-Native Payments. Specification, 2025.
63. Berners-Lee, T. Semantic Web on XML. Keynote, XML 2000, Washington DC, 6 December 2000.
64. Hendler, J. Tonight's Dessert: Semantic Web Layer Cakes. Keynote, ESWC 2009.
