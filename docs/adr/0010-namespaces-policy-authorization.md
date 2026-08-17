# ADR-0010: Hierarchical namespaces + policy-based authorization

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Retrofitting multi-tenancy after a global graph is painful. RBAC alone cannot express “an agent acting for user A may read derived claims only while the task delegation lasts and classification allows.” MCP HTTP auth and A2A transport security put identity at the edge; the application must still authorize **resource + action + purpose**.

Policy evaluation in the product sense (credit floors, TLP, clinical contraindications) is related but not identical to ACL. Both belong in a policy capability; neither belongs as hard-coded `if role == admin` in retrieval.

## Decision

- **Hierarchical ownership from day one:** organization → workspace/team → project; user-private knowledge/context/memory; shared agent memory under workspace.
- Every object carries `tenant_id`, `namespace_id`, optional `principal_id`, `classification`, `visibility`, `policy_tags[]`.
- Authorization abstraction:

  ```text
  allow(principal, action, resource, context)
  ```

  where `context` includes tenant, classification, agent identity, purpose, and delegation. **RBAC is an input**, not the model.
- Retrieval and context assembly **must** apply policy filters before data reaches a model.
- Product policies (decision compliance, exceptions, version impact) live in `capability-policy` and are versioned graph/SQL records; they reuse the same principal/resource/action vocabulary where applicable.
- Standalone binds a single local principal and a default workspace so ACL is real but invisible in UX.

## Consequences

**Positive**

- Agent-on-behalf-of-user is expressible without a second permission system.
- Classification and purpose-based retrieval are first-class.
- Compose/cloud OIDC maps onto `principal` without schema churn.
- Coding agents on `/mcp/retrieve` cannot widen scope by calling a different tool name if authorization is in the command layer.

**Negative**

- More metadata on every write; importers must set namespace/classification.
- Policy engine complexity vs Semantica’s simple `min_*` dicts; start with a small, tested rule vocabulary and avoid a general programming language in v1.
- Incorrect default-open namespaces would be a serious incident; defaults are deny across tenant boundaries.

## Alternatives considered

- **RBAC only:** cannot model delegation, purpose, or classification well.
- **Single global graph + app-level filters:** will leak in queries and projections.
- **OPA/Cedar as kernel:** optional later `PolicyProvider` plugin; do not block v1 on an external language, but keep the `PolicyProvider` port so Cedar/OPA can bind later.
