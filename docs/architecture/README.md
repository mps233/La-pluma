# Architecture Governance

This directory is the durable record of the architecture-governance effort:
the architecture map, the invariant list, the decision log, the task pool, and
the round-by-round progress log.

It is not a second copy of `DESIGN.md` or `AGENTS.md`. Those remain
authoritative for visual rules and working rules respectively. This directory
records how the codebase is being converged toward the properties below and
what is still outstanding.

## Target properties

1. **Single source of truth** — every business rule, data definition,
   configuration, state, and design rule has one authoritative owner.
2. **Canonical implementation** — one standard implementation per semantic
   responsibility; parallel implementations are either migrated or explicitly
   documented as intentional compatibility.
3. **Deep modules** — complexity is encapsulated behind small, stable
   interfaces. No pass-through layers and no abstractions that leak internals.
4. **High cohesion, low coupling** — every module has one job, one owner, and
   dependencies point in one direction. No cycles, no cross-layer access, no
   shared mutable state.
5. **Locality of change** — changing one business concept touches one logical
   place.
6. **Deletion over accumulation** — replacing an implementation includes
   migrating every caller and deleting the old one. New and old systems do not
   coexist indefinitely.
7. **Enforceable architecture** — invariants that matter are checked by the
   type system, lint, tests, or CI, not only by prose.

## How work is organized

- **Every round is a closed loop**: scan → evidence → choose the lowest-total-
  complexity option → baseline the behavior → migrate all callers → delete the
  replaced implementation → independent review → verify → add a regression
  guard → record the result.
- No round may leave a new abstraction with unmigrated callers.
- Rounds happen in an isolated git worktree, one commit per coherent
  improvement, with verification before each commit.
- Decisions that need a product decision, a breaking migration, or a large
  architectural bet are recorded in `DECISIONS.md` as *proposed/pending* and
  left out of the current round.

## Files

- `ARCHITECTURE.md` — the current map: module responsibilities, dependency
  direction, state ownership, and canonical owners.
- `INVARIANTS.md` — the enforceable rules and where each is enforced.
- `TASKS.md` — the prioritized pool of remaining governance work.
- `PROGRESS.md` — the round log with baselines, changes, and verification.
- `DECISIONS.md` — architecture decision records, including pending decisions.

## Verification baseline

Commands used to judge a round (see `AGENTS.md` for the full list):

```bash
cd go && go test ./... && go vet ./...
npm run lint --prefix client
npm run type-check --prefix client
NODE_OPTIONS=--no-experimental-webstorage npm run test --prefix client
npm run build --prefix client
```

The client test flag is required on Node.js 26 (its built-in Web Storage
breaks jsdom's `localStorage`).
