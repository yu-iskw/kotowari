# Kotowari Product Design

**Product:** Kotowari
**Repo:** `kotowari`
**Audience:** product, compliance, and engineers who will not read architecture first
**Companion:** [system-design.md](./system-design.md) (how it is built) · [ADRs](./ADRs/README.md) (why irreversible choices were made)

---

## 1. Name and positioning

**Kotowari** (理 / 断り) is the account you can give for a claim or a decision: the reason, the principle, and the justification that would survive a later “why?”

Kotowari is the **context-and-accountability layer under agents and applications**. It does not replace Claude Code, Cursor, Codex, OpenCode, ADK, Mastra, DeepAgent, or Vertex AI. Those systems act. Kotowari remembers what they knew, what they chose, where the facts came from, which policy was in force, and what happened afterward.

It answers questions that vector RAG and chat logs cannot:

- What does the organization currently believe?
- Where did that knowledge come from?
- Who is allowed to see or use it?
- What did an agent know when it acted?
- Which policy was in force?
- What decision did it make, and what alternatives were considered?
- What happened afterward?
- What has changed since?
- Can another agent safely consume this context?
- Can we reproduce or audit the result?

Kotowari is one product with three ways to run it. Standalone feels like a local app. Enterprise local (Docker Compose) feels like the same app with login and workers. Cloud feels like the same app at organizational scale. Semantics do not change with the environment.

---

## 2. The problem

Powerful agents are not automatically trustworthy ones. Production teams hit the same structural gaps:

**No memory structure.** Agents store embeddings, not meaning. There is no way to ask why a fact was recalled, no link from a recalled fact back to a source document, and context resets between runs.

**No decision trail.** Agents act continuously but record nothing durable. Debugging means re-running, not reviewing. A regulator or incident reviewer has nothing to hand.

**No provenance.** Outputs cannot be traced to source facts. In healthcare, finance, legal, and government, that is a hard blocker.

**No reasoning transparency at system level.** Black-box answers with no explanation of *what the system did*: which evidence was selected, which policy applied, which decision was recorded. (Kotowari does not claim to explain what happened inside a foundation model.)

**No conflict detection.** Contradictory facts silently coexist. Outputs become inconsistent as the knowledge base grows.

**No shared organizational context.** Each agent, IDE, and service keeps its own scratchpad. Precedent from last quarter’s similar case is invisible.

These are not capability gaps. They are an **accountability gap**. Kotowari closes that gap for humans, coding agents, application agents, and internal services.

---

## 3. Who it is for

### 3.1 Individual developer

A single engineer on a laptop. They want sourced answers over their own files, a memory that survives restarts, and a decision they can point to later. They will not run Docker, Postgres, or an identity provider on day one.

**Job to be done:** “Ingest this folder, answer from it with sources, and remember what I decided.”

### 3.2 Platform engineer

They must offer the *same* product to the rest of the company: identity, object storage, background work, and a path to Google Cloud. They need Compose for inner loop and Terraform later, without maintaining a second product.

**Job to be done:** “Turn on enterprise local tonight; promote the same behavior to GCP without rewriting agents.”

### 3.3 Compliance, risk, and audit

They are asked “why did the AI do that?” months later. They need a replayable record: evidence, policy version, actor, outcome—not a screenshot of a chat.

**Job to be done:** “Export a defensible trail for this decision, including what the agent was allowed to see.”

### 3.4 Coding agent (Cursor, Claude Code, Codex, OpenCode)

The agent works in a repo. It should install a Kotowari plugin, call tools, and never import Kotowari internals. Skills and MCP tools are the product surface.

**Job to be done:** “Search organizational memory, write what I learned, record the decision, stay inside policy.”

### 3.5 Application agent (ADK, Claude Agent SDK, Mastra, DeepAgent, and future frameworks)

Long-running or multi-agent systems that need shared context and audit. They use a TypeScript SDK or MCP. The framework is not a Kotowari dependency.

**Job to be done:** “Build task context for this purpose, act, record the decision, hand off to another agent safely.”

### 3.6 Knowledge curator / analyst

A human who resolves conflicts, inspects evidence, and reviews decisions. They use the web app and, when they are already in an AI client, MCP Apps inspectors.

**Job to be done:** “See competing claims, pick a resolution, and leave a reason that the next agent will see.”

---

## 4. Value

| Value | What the user gets |
| --- | --- |
| **Auditability** | Every important write carries provenance. Decisions are records, not log lines. Policy checks and exceptions are part of the same trail. |
| **Reusable context** | Knowledge, memory, and decisions compound across sessions, agents, and teams instead of dying in a context window. |
| **Competing truths** | Two sources can disagree without silent overwrite. Conflicts are visible and resolvable. |
| **Purpose-built context** | Retrieval is for a *purpose* (code review, underwriting, incident) with policy applied *before* the model sees anything. |
| **Same product, three runtimes** | Laptop, Compose, and cloud share behavior. Agents do not learn a second API. |
| **Plugin-speed extension** | New models, sources, and IDE packs plug in without changing the product core. AI coding agents can add a connector as a bounded unit of work. |
| **System-level explainability** | Kotowari explains what the *system* did: evidence, retrieval, policy, decision, outcome. It does not reconstruct model chain-of-thought. |

Kotowari complements the existing stack. Keep the LLM, the IDE, and the agent framework. Add the layer that makes their outputs grounded, traceable, and shareable.

---

## 5. Product principles

1. **One product model.** Standalone and enterprise expose the same semantic behavior, not necessarily the same physical infrastructure.
2. **Knowledge is not a graph.** A graph is a way to look at claims. Claims, evidence, and decisions are the product objects.
3. **Memory is not knowledge.** Knowledge is durable belief about the world. Memory is experience from agent or user activity. Context is a selection of both for a purpose.
4. **Provenance is not optional.** If it cannot be attributed, it is not a first-class write.
5. **Decisions are objects.** Category, scenario, evidence, policies, alternatives, outcome, and later observed result live together.
6. **Observable justification only.** Persist evidence, tool calls, policies, and outputs. Do not persist hidden chain-of-thought.
7. **Policy evaluates; workflows decide.** A failed check flags and records; humans or workflows choose block, exception, or escalate.
8. **Agents are guests.** Frameworks and IDEs consume Kotowari; they do not live inside it.
9. **Inspectors in chat, a real app on the web.** MCP Apps are in-conversation views. The product still has a normal web application.
10. **Least privilege by purpose.** An agent acting for a user sees only what that user plus the current task delegation allows.

---

## 6. Features

Product language. Implementation lives in [system-design.md](./system-design.md).

### 6.1 Knowledge claims

Durable, typed beliefs about the world: who works where, which CVE is exploited by whom, which guideline contraindicates a drug. A claim has subject, predicate, object, validity window, confidence, status, namespace, and visibility.

Claims can compete. “Alice is CEO as of 2024” and “Alice left in 2025” can both exist with time bounds. Two extractors can assert different objects for the same fact; Kotowari surfaces the conflict instead of picking silently.

### 6.2 Evidence locker

Immutable source material that supports claims: files, pages, warehouse extracts, emails, transcripts. Intermediate parse and normalize artifacts can be kept so extraction can be rerun when models improve—without reconnecting to Salesforce or GitHub.

Users browse evidence, jump from a claim to the passage that justified it, and see who ingested it and with which extractor version.

### 6.3 Context assembly

Context is not “the whole graph.” It is **selected knowledge + runtime/task/user state for a purpose**. A code-review context and an underwriting context over the same workspace are different slices, with different policy filters and hop budgets.

Every assembled context can be snapshotted onto a decision so later review sees what the agent was actually given.

### 6.4 Agent and user memory

Experience retained from activity: observations, conversation namespaces, incident threads, private notes. Memory is scoped (organization, workspace, project, user, agent run) so a personal scratchpad does not leak into the organizational knowledge base, and a Tier-1 SOC thread does not contaminate an unrelated investigation.

### 6.5 Decision records

A decision is a first-class object: scenario, considered evidence, applicable policies, selected outcome, alternatives, confidence, actor (human or agent), model/runtime, resulting actions, and optional later observed outcome.

Users search **precedents** before acting, trace **causal** links (what led here, what this caused), and export an audit pack. This is organizational learning, not a logging feature.

### 6.6 Policy evaluation and exceptions

Named, versioned policies over decisions and retrieval (confidence floors, allowed outcomes, classification, purpose). Evaluation returns compliant or not. Non-compliance can trigger exception recording, approval chains, and re-audit when a policy version changes.

What-if: “If we raise the credit-score floor, which past decisions would have failed?”

### 6.7 Hybrid retrieval with explanation

Lexical, vector, graph-neighborhood, temporal, and metadata filters, then rerank, then policy filter. Each result explains why it was selected: score components, source evidence, graph route, policy filtering, freshness.

“GraphRAG” is a retrieval *plan*, not a separate product. Users debug bad answers by inspecting the plan, not by guessing the prompt.

### 6.8 Conflict surfacing and resolution

Value, type, temporal, and logical conflicts. Resolution strategies include recency, source credibility, majority, and human review. Resolutions are themselves recorded with provenance so they can be revisited.

### 6.9 Temporal “as of”

Point-in-time views of knowledge and decisions. “What did we believe about this vendor on 15 June 2021?” Validity time (when it was true in the world) and recorded time (when Kotowari learned it) are both first-class.

### 6.10 Identity, namespaces, and visibility

Organization → workspace/team → project, plus user-private knowledge, context, and memory. Every object carries tenant, namespace, classification, visibility, and policy tags. The same UI shows “what I can see” rather than “everything in the database.”

### 6.11 Surfaces people actually use

- **Web application** — search, evidence, claims, decisions, conflicts, policies, admin.
- **CLI** — init, start, ingest, status, for individuals and CI.
- **MCP (v2)** — tools for coding and application agents, with narrower servers for retrieve / knowledge / memory / ingestion / admin so a coding agent is not handed dangerous operations by default.
- **MCP Apps** — in-chat inspectors: neighborhood graph, evidence, decision audit, policy result, retrieval debugger, memory browser.
- **TypeScript SDK** — applications embed Kotowari without speaking JSON-RPC.
- **Agent plugins** — Cursor, Claude Code, Claude Agent SDK, and siblings: install, authenticate, work.

### 6.12 Model choice without product fork

Default enterprise path is Gemini on Vertex AI. Individuals can use a local or other hosted model. The product talks about *capabilities* (tools, structured output, embeddings), not vendor names, in the UI.

---

## 7. User stories

Stories use Given / When / Then. They are acceptance criteria for the product, not for a particular database.

### 7.1 Individual developer

**S1 — Zero-friction start**
Given I have Node.js and a folder of documents
When I run `npx kotowari init && kotowari start`
Then a local app is serving web, REST, and MCP without Docker, Postgres, or an account
And I can open the UI and see an empty workspace ready to ingest.

**S2 — First sourced answer**
Given a running standalone Kotowari and a directory of PDFs
When I ingest the directory and ask “What did we decide about vendor X?”
Then I receive an answer with claims linked to evidence passages
And I can click through to the source file.

**S3 — Remember a decision**
Given I just chose a library for a HIPAA workload
When I record a decision with scenario, reasoning-as-justification, outcome, and confidence
Then that decision is searchable as a precedent next week
And it is still there after I restart the process.

**S4 — Coding agent on a laptop**
Given Cursor (or Claude Code) with the Kotowari plugin
When I ask the agent to extract entities from a spec and record an attribution decision
Then the agent uses MCP tools only
And the graph and decision appear in the local UI
And the agent never needs a Kotowari source checkout.

### 7.2 Platform engineer

**S5 — Enterprise local is the same product**
Given the Compose profile
When I `docker compose up`
Then I get the same API and UI behavior as standalone, plus login (dev OIDC), object storage, and a worker
And my existing MCP plugin works after pointing at the Compose URL and signing in.

**S6 — Promote to cloud without agent rewrites**
Given agents already talk to Compose Kotowari
When we deploy the GCP environment
Then those agents keep using REST/MCP/SDK
And only identity, URLs, and scale change.

**S7 — Contract parity**
Given the standalone, Compose, and cloud profiles
When I run the published capability contract tests
Then knowledge write, retrieval policy filtering, and decision recording pass on all three.

### 7.3 Compliance and risk

**S8 — Replay a decision**
Given a recorded lending (or clinical, or containment) decision
When I open its audit view
Then I see the context snapshot, evidence list, policy versions evaluated, actor, outcome, and exceptions
And I can export PROV-O or JSON for the file.

**S9 — Policy change impact**
Given a year of mortgage decisions under policy v2.3
When I simulate raising the credit-score floor
Then I see which past decisions would have failed
And I can version the policy and queue those cases for re-audit.

**S10 — Right-to-know / classification**
Given a TLP:RED or patient-identified record
When an agent for a user without clearance requests retrieval
Then the item is omitted from context
And the omission is explainable in the retrieval debugger (policy filter), not a silent empty hit.

### 7.4 Coding agents

**S11 — Install and go**
Given I work in Cursor or Claude Code
When I install the Kotowari agent plugin
Then MCP stdio (standalone) or Streamable HTTP with my identity (enterprise) is configured
And skills describe when to search memory vs record a decision vs ingest.

**S12 — Least privilege tools**
Given I am a coding agent in a product repo
When I connect to Kotowari
Then I see retrieve / knowledge / memory tools
And I do not see admin or unrestricted ingestion unless an admin granted that profile.

**S13 — In-chat inspection**
Given a compatible client (Claude, VS Code, others with MCP Apps)
When I call a tool that returns a decision or neighborhood
Then an inspector UI renders in the conversation (graph, evidence, policy)
And I can still open the full web app for heavy curation.

### 7.5 Application agents

**S14 — Purpose-built context**
Given an ADK or Claude Agent SDK agent with a task id
When it asks Kotowari to build context for purpose `code-review`
Then it receives a bounded, policy-filtered slice
And a snapshot id it can attach to the later decision.

**S15 — Multi-agent handoff**
Given an OSINT collector and a reasoning agent in different processes
When the collector writes evidence and claims, then the reasoner reads context for the same case
Then both see a consistent workspace
And namespaces keep collector scratch separate from the published synthesis.

**S16 — Thin framework adapters**
Given Mastra, DeepAgent, or a future framework
When we add support
Then we ship a small adapter (`createMastraTool(client)`)
And we do not add that framework to the Kotowari core.

### 7.6 Curator / analyst

**S17 — Resolve a conflict**
Given two claims that disagree on a fact
When I choose a resolution and write a reason
Then future retrieval prefers the resolved view
And both claims plus the resolution remain in the audit trail.

**S18 — Rerun extraction**
Given evidence stored from last quarter and a better extractor
When I re-run extraction on stored evidence
Then new claims are versioned against the same evidence
And I do not re-download from the original SaaS.

---

## 8. User experience

### 8.1 Standalone: a local app

Desired first five minutes:

1. `npx kotowari init` creates a workspace directory and config.
2. `kotowari start` opens web UI on localhost and starts REST + MCP (stdio and local HTTP).
3. Drag-and-drop or `kotowari ingest ./docs`.
4. Search in the UI or ask the IDE plugin.
5. Record a decision from the UI or the agent.

No Redis, Postgres, Neo4j, or Kubernetes. Restarting the process restores knowledge, memory, and decisions from local files. The UI copy talks about *workspace*, *sources*, *answers*, *decisions*—not “vector index” or “Cloud Run.”

Empty states teach the next action: “Ingest a folder,” “Connect Cursor,” “Record your first decision.”

### 8.2 Enterprise local: the same app, with a door

`docker compose up` is for platform engineers and anyone testing identity. The UI gains sign-in (dev OIDC). Ingestion of large sets shows a job queue. Object storage holds blobs. Behavior of search, decisions, and policy matches standalone.

Compose is not a Google Cloud emulator. Users should not need a GCP account to develop. They should need to prove that **ports and product contracts** still hold.

### 8.3 Enterprise cloud: the same app, at org scale

Users sign in with company identity. Workspaces map to teams. Classification labels appear on documents and claims. Admins manage policies, connectors, and which MCP profile a client may use. Heavy ingest is “a job” in the UI, not a spinning browser tab.

Coding agents authenticate as the user (delegated), not with a shared service key, so audit shows *who* the agent acted for.

### 8.4 UX principles across modes

- **Progressive disclosure.** Individuals never see tenant IDs. Compliance users see policy versions and provenance by default.
- **Source before flourish.** Every grounded answer shows citations first; the narrative is secondary.
- **Decision over chat.** High-stakes flows end on “Record decision” / “Find precedents,” not only “Regenerate.”
- **Explain retrieval.** A “Why these results?” panel is a product feature, not a debug flag buried in logs.
- **MCP Apps are inspectors.** Rich in-chat UI for graph, evidence, decision, policy, retrieval debug, memory. Curation, bulk ingest, and admin stay in the web app.
- **Errors name the product concept.** “Policy `pol-credit-001` v2.4 denied `knowledge.read` on classified evidence,” not a generic 403.

### 8.5 Agent plugin experience

Installing the Cursor or Claude Code plugin should feel like installing a well-scoped extension:

- Manifest, skills, and MCP config; no kernel access.
- Skills tell the agent *when* to search vs write vs record a decision.
- Enterprise: OAuth in the client; tokens audience-bound to the Kotowari resource.
- Standalone: stdio to the local process; graph path on disk.

Claude Agent SDK, ADK, and others get a few lines of client setup, not a Kotowari-shaped rewrite of their runtime.

### 8.6 What we refuse to persist in the UX

The UI never invites users to “save the model’s private chain-of-thought.” Justification fields are evidence, tool results, policy outcomes, and human- or agent-authored rationale that they are willing to stand behind.

---

## 9. End-to-end journeys (narrative)

### 9.1 Laptop to first precedent

Mika clones a research repo, starts Kotowari, ingests `./papers`, asks Cursor “What is the contraindication for metformin below eGFR 30?” The plugin retrieves claims with BNF evidence, she records `discontinue_metformin` as a decision, and next month `find precedents` returns that case.

### 9.2 SOC shift handoff

Tier 1 logs alerts into an incident memory namespace and records a low-confidence triage. Tier 2 opens the same incident, sees the thread and similar past containments, records isolation with policy check, and the manager reads the full trail without the ticket archaeology.

### 9.3 Credit committee

Risk desk, compliance desk, and chair work in one workspace with separate memory namespaces. Each records a decision. The chair’s final decision links them. Audit exports one pack. A later policy tightening runs impact analysis on the book.

### 9.4 Platform rollout

Platform team validates Compose with contract tests, deploys GCP, points Cursor plugins at the HTTP MCP retrieve profile, and Vertex Gemini becomes the default extractor. Developers who still use standalone for personal notes keep the same mental model.

---

## 10. Non-goals (product)

Kotowari will not, in v1, try to be:

- A new **agent framework** or replacement for Claude Code, Cursor, ADK, or Mastra.
- A **model gateway** or universal LLM proxy.
- A **required graph database** product (Neo4j/Neptune as the thing you “buy Kotowari to get”).
- A **Kubernetes platform**.
- A **generic workflow DSL** (agent frameworks already orchestrate).
- An explainer of **foundation-model internals**.
- A dump of every enterprise connector on day one (connectors are an ecosystem, not the core value).

The important product primitives are knowledge, context, memory, evidence, decisions, policy, access, and interoperability.

---

## 11. Success metrics

| Metric | Intent |
| --- | --- |
| Time to first sourced answer on a laptop | Standalone UX is real, not a demo that needs Compose. |
| Share of consequential agent actions with a decision + provenance record | Accountability is used, not optional. |
| Contract-test parity across standalone, Compose, and cloud | One product, three profiles. |
| Retrieval debugger usage on “wrong answer” incidents | Explainability is operational, not a slide. |
| Time for an AI coding agent to add a source or model plugin that passes contract tests | Extensibility matches the “ultra-rapid” goal. |
| Audit export opened in a real review (credit, clinical, IR) | Compliance value is not theoretical. |

---

## 12. Glossary (product)

| Term | Meaning |
| --- | --- |
| **Knowledge** | Relatively durable claims about the world. |
| **Context** | Selected knowledge + runtime/task/user state for a purpose. |
| **Memory** | Experience retained from agent or user activity. |
| **Evidence** | Immutable source material supporting claims. |
| **Decision** | Recorded choice with observable justification, not a log line. |
| **Policy** | Versioned rules governing reads, writes, actions, and reasoning. |
| **Provenance** | Who/what/when/how a record came to be. |
| **Claim** | The unit of belief (with time, confidence, and sources). |
| **Conflict** | Disagreement among claims that must be visible. |
| **Namespace** | Org / workspace / project / user scope of ownership. |
| **MCP App** | Interactive inspector rendered inside a compatible AI client. |
| **Agent plugin** | IDE or SDK pack that talks to Kotowari through MCP or the SDK. |

---

## 13. Document map

| If you need | Read |
| --- | --- |
| Why the product exists and how it feels | This document |
| How the system is structured, stored, and deployed | [system-design.md](./system-design.md) |
| Why we froze a given technical choice | [ADRs](./ADRs/README.md) |
| How we prove behavior (including Cursor Cloud) | [quality-assurance.md](./quality-assurance.md) |
