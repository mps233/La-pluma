# Architecture Decision Records

Format: a decision gets an ID, a status (`accepted`, `pending`, `superseded`),
the context, the decision, and the consequences. Pending decisions need a
product or maintainer call and are not implemented by governance rounds.

## ADR-0001: Governance records live in `docs/architecture/`

Status: accepted (2026-11-28)

Context: the repository had no durable place for architecture decisions,
canonical-owner maps, or the refactor backlog. Governance knowledge was spread
across `AGENTS.md`, `README.md`, `DESIGN.md`, and the Go rewrite plan.

Decision: create `docs/architecture/` with an architecture map, invariants,
task pool, progress log, and this decision log. These files describe the
current intended architecture; they never override `DESIGN.md` (visual rules)
or `AGENTS.md` (working rules).

Consequences: every governance round updates `PROGRESS.md`; every accepted
structural decision gets an ADR; stale entries are corrected rather than
duplicated.

## ADR-0002: `AGENTS.md` stays the working-rule SSOT

Status: accepted (2026-11-28)

Context: `AGENTS.md` is loaded by coding agents and already contains the
working rules, verification commands, and safety constraints.

Decision: governance work does not duplicate those rules into
`docs/architecture/`. It references them and adds only the architecture map,
invariants that are being enforced mechanically, and the task pool.

Consequences: one source of truth per rule; governance docs stay small.
