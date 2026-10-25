# Repair algorithm

Implementation: [`repair_engine.cpp`](../compiler/src/repair_engine.cpp), [`repair_stream.cpp`](../compiler/src/repair_stream.cpp), configuration in [`repair.hpp`](../compiler/include/parallax/repair.hpp).

## 1. Pipeline

| # | Stage | Output | Reported as |
|---|---|---|---|
| 1 | Input checks (size ≤ 64 KB) | — | CLI/API error `INPUT_TOO_LARGE` |
| 2 | Lex | tokens with spans | stage `lex` |
| 3 | Parse (panic mode) | diagnostics, AST if valid | stage `parse` |
| 4 | Localise (stop-at-first parse) | error index *e*, exact expected set, LR state | stage `localise` |
| 5–7 | Generate candidates, apply edits to copies of the token stream, validate with the parser | candidates with outcomes | stage `generate-and-validate` |
| 8 | Reconstruct source, re-lex, re-parse, build the AST | round-trip check, residual diagnostics, canonical AST | (inside stage 5–7) |
| 9 | Evidence extraction and ranking | scores with per-feature contributions | stage `rank-and-group` |
| 10 | AST grouping | equivalence classes | stage `rank-and-group` |
| 11 | Hypothesis lanes, follow-on diagnostics, stability | leaves, stability table | stage `hypothesis-lanes` |
| 12 | Decision | status, reasons, plans | stage `decide` |

Every stage records its status and wall time. The UI shows only the stages that actually ran.

## 2. Edits and cost model

An edit is `Insert(pos, kind)`, `Delete(pos)` or `Replace(pos, kind)` on a token stream. Edits in a sequence apply to the stream produced by the previous ones.

| Operation | Cost | Rationale |
|---|---|---|
| insert | 1.0 | one invented token |
| delete | 1.0 | one removed token |
| replace | 1.5 | one local change, but it both removes and invents; cheaper than delete + insert (2.0) |

Inserted identifiers and literals get **visible placeholders** (`__hole`, `0`, `0.0`, `'?'`, `true`/`false`). IntelliFix never pretends to know a missing name.

## 3. Candidate generation (bounded)

Let *S* be the token stream and *e* the index of the first error.

1. **Window generator.** For each *p* ∈ [*e* − 3, *e*] (`window_back = 3`):
   `X = expected_at(S, p)` — the exact set of kinds the parser accepts after `S[0, p)` (LAC probe).
   Propose `Insert(p, k)` for each *k* ∈ X, `Delete(p)`, and `Replace(p, k)` for each *k* ∈ X with *k* ≠ kind(*S*[*p*]).
2. **Layout generators** (only when `layout` is on). Scan up to 60 tokens back from *e* − 4, at most 6 positions each:
   - `;` at line boundaries, where `;` ∈ `expected_at`;
   - `{` after `)` or `else` when the next line is indented further (`indent-open`);
   - `}` before a dedented line (`indent-close`);
   - deletion of a delimiter doubled with its neighbour (`duplicate`).
3. **Cost-2 search (iterative deepening on cost).** Only if no single edit is accepted: take up to 12 *seed* single edits that did not make things worse (outcomes `defers-error` or `same-location`, ordered by how far they got). Around each seed's new error *j*, try insertions and deletions at positions [max(seed position, *j* − 2), *j*].
4. **Deduplication.** Candidates whose resulting token sequence equals an earlier one are marked `duplicate`.

Repairs needing three or more edits at one error site are **out of scope** (catalog cases S33/S34 demonstrate `NO_SAFE_REPAIR`).

## 4. Validation (every “parser-valid” claim is a real parse)

For each candidate:

1. Apply the edits to a **copy** of the stream and run a stop-at-first parse. Let *j* be the new first error (if any), *q* the end of the edited region, and *o(j)* the original-source index of token *j* (synthetic tokens map to the next original token).
2. Classify:

| Outcome | Condition | Accepted? |
|---|---|---|
| `valid` | no error | yes |
| `local-repair` | *o(j)* > *o(e)* and *j* − *q* ≥ 3 (`min_progress`) | yes |
| `defers-error` | *o(j)* > *o(e)* but progress < 3 — **only moves the error** | no |
| `same-location` | *o(j)* = *o(e)* | no |
| `earlier-error` | *o(j)* < *o(e)* | no |
| `duplicate` | same token stream as an earlier candidate | no |
| `malformed` | source round trip failed (below) | no |

3. **Source round trip** for accepted candidates. Rebuild text from the edited stream, reusing the user's whitespace and comments (deleted tokens drop their leading blanks; inserted `;)],` attach to the left; inserted `([` attach to the right; a space is inserted wherever two tokens would otherwise glue, e.g. `/` + `*`). Re-lex the text and require **exactly** the edited (kind, lexeme) sequence, then re-parse it with panic-mode recovery. If token-level and source-level validity disagree, the candidate is `malformed`.

There are no temporary files; parsing is in memory and re-entrant.

## 5. Evidence model

`score = Σ value_f × weight_f`. Weights were fixed on the **dev split** only and then frozen (commit `03331c0`). The score is a ranking device, **not a probability**.

| Feature | Group | Value | Weight |
|---|---|---|---|
| `edit_cost` | edit | total cost | −1.0 |
| `resolves_all_errors` | parser | 1 if the program parses completely | +2.0 |
| `placeholder_tokens` | edit | invented identifiers/literals | −1.5 |
| `deleted_content` | edit | user names, literals or keywords deleted or overwritten | −0.75 |
| `distance_from_error` | parser | min(5, \|*e* − first edit position\|), window/pair edits only | −0.2 |
| `line_end_semicolon` | layout | `;` inserted exactly at a line break | +0.75 |
| `indentation_brace` | layout | brace inserted where indentation changes | +0.75 |
| `duplicate_deletion` | layout | deleting a delimiter doubled next to itself | +0.5 |
| `indentation_mismatch` | layout | statements whose column disagrees with their block, plus closing braces not aligned with the line that opened the block, in the repaired AST (minus the minimum over valid alternatives; capped at 4) | −0.5 |
| `name_warnings` | names | undeclared/duplicate/arity warnings in the repaired AST (minus the minimum over valid alternatives) | −0.75 |
| `residual_errors` | stability | panic-mode diagnostics left after the edit (cap 6) | −0.5 |
| `cascade` | stability | 1 if the total number of diagnostics did not decrease | −1.0 |
| `completion` | stability | extra cost to repair the follow-on errors on this hypothesis's lane; unreachable or unexplored → fixed penalty −2.5 | −0.5 per cost unit |

Ties: lower cost, then generation order (deterministic). The UI shows every contribution and, for any two candidates, the per-feature difference that explains their order (“Why rank 1 outranks rank 3”).

**Least-cost baseline (C)** uses the same candidates with every weight zero except `edit_cost`, no grouping, no layout generators, one greedy lane and no abstention.

## 6. AST grouping

Accepted candidates are grouped by an equivalence key:

- complete programs: the canonical AST (see AST_AND_REPRESENTATIONS.md);
- candidates that leave later errors: the canonical form of the **panic-mode recovered tree** (prefixed `recovered:`), a weaker but deterministic structural key;
- otherwise the token sequence.

Example: for `int b = (a + 2;`, inserting `)` after `2` or after `a` gives `(a + 2)` and `(a) + 2`. These are different edits but one class, so they do not compete in the margin. With grouping disabled (ablation D) they do, and the status changes from `RECOMMENDED` to `MULTIPLE_PLAUSIBLE` (test `repair_ast_grouping_merges_equivalent_candidates`).

## 7. Hypothesis lanes and follow-on stability

```
for each of the top R = 3 classes (by score without completion):
    explore(class representative, depth = 1)

explore(stream, depth):
    j ← first error of stream
    if none: leaf(valid)
    if depth = 4 or leaves = 12 or budget exhausted: leaf(stopped, truncated)
    candidates ← generate+validate+score at j      # same machinery, on the edited stream
    take the top B = 2 classes at this step
    record margin(best class, second class) for this step
    for each: explore(stream after its edits, depth + 1)
```

- **Completion evidence:** for each root class, the cheapest valid leaf gives the extra cost beyond the root edit.
- **Plan:** the root class with the best final score, and its best leaf (valid first, then lowest total cost, then highest score sum).
- **Stability:** for each explored root hypothesis, collect the original-source sites of (a) errors met on its best path at depth ≥ 1 and (b) panic-mode diagnostics left by its root edit. A site found under **every** explored hypothesis (with ≥ 2 hypotheses) is reported as *stable across the tested hypotheses*; otherwise *hypothesis-dependent*. This is evidence, not proof of independence.
- Limits and truncation are reported (`hypotheses.truncated`).

## 8. Decision policy (confidence-aware abstention)

Checked in this order:

| Status | Condition |
|---|---|
| `NO_REPAIR_NEEDED` | the original parses |
| `UNSUPPORTED_CONSTRUCT` | the first error token is an `UNSUPPORTED` C construct (unless abstention is disabled), **or** the parser hit its stack limit (nesting too deep); in the second case no search is run, because no token edit near the limit can make the input parse |
| `NO_SAFE_REPAIR` | no candidate is accepted and the budget is not exhausted |
| `BUDGET_EXHAUSTED` | the budget ran out before a complete plan was found |
| `LOW_CONFIDENCE` | the best plan does not reach a valid program, **or** it contains placeholder tokens |
| `MULTIPLE_PLAUSIBLE` | margin < τ, where the margin is the minimum of (best class score − second class score) at the root and at every later step of the plan |
| `RECOMMENDED` | otherwise (a single distinct class counts as an unbounded margin) |
| `COMPILER_FAILURE` | set by the backend when the compiler crashes, times out (`504`) or is missing (`503`) |

With abstention disabled (ablation F), any existing plan is `RECOMMENDED`.

**τ selection.** On the dev split, τ ∈ {0, 0.25, …, 4} is chosen to maximise coverage subject to dev selective risk ≤ 10%. The result is **τ = 1.5**. This is a threshold on a score margin; no probability calibration is claimed (so no calibration error is reported). The policy is exactly reproducible offline from stored margins; the evaluation checks this against direct `--tau` runs (25/25 identical in the 25 Oct 2026 re-run, after fixing a harness bug that had hidden this count).

## 9. Search limits and failure handling

| Limit | Default |
|---|---|
| parser invocations (all stages) | 30,000 |
| wall clock | 4,000 ms |
| window / layout reach / layout positions | 3 / 60 / 6 |
| pair seeds | 12 |
| lane roots / branch / depth / leaves | 3 / 2 / 4 / 12 |
| reported candidates / rejections | 40 / 40 |

Budget exhaustion sets `budget.exhausted` and stops further generation; the status reflects it. Deep nesting is caught by the parser's stack limit. The process is bounded by the backend timeout (15 s) and the input limit (64 KB).

**Complexity.** Let *n* be the number of tokens and *k* the largest expected-set size (≤ 25). One parse is O(*n*). A repair step tries O(*w*·*k*) single edits (*w* = 4 positions), plus O(*s*·*k*) pairs only when needed (*s* = 12 seeds). Lanes multiply this by at most 3 + 3·2 + … bounded by the 12-leaf cap. Measured on the test split: mean 306 parser invocations per case (p95 1112), about 10–14 ms engine time on average (9.6–13.9 ms across three runs; it depends on machine load, the parse count does not).

## 10. Pseudocode (top level)

```
run_repair(source):
    T ← lex(source); P ← parse_panic(T)
    if P.ok: return NO_REPAIR_NEEDED
    e ← first_error(T)
    C ← generate_and_validate(T, e)            # sections 3–4
    score_local(C); classes ← group(C)         # sections 5–6
    for top-3 classes: explore lanes           # section 7
    add completion evidence; re-rank; regroup
    compute stability
    return decide(classes, lanes, τ)           # section 8
```

## 11. Tests

`compiler/tests/test_repair.cpp` (24 tests). They cover edit application and origin mapping, exact identity reconstruction, comment preservation, token-glue prevention, each status, a property test that every accepted candidate's reconstructed source really parses, grouping vs no grouping, deferred and duplicate detection, multi-error plans with stable diagnostics, indentation and arity evidence, the doubled-brace generator, forced top-1, least-cost weights, lexical-error candidates, determinism, EOF-in-block and empty input. Error-catalog cases R01–R10 run the same behaviours through the CLI.
