# Evaluation protocol

Code: [`evaluation/`](../evaluation). Reproduce with `./scripts/run_evaluation.sh` (about one minute on 4 CPUs).

## 1. Dataset

- **Sources:** 30 hand-written, valid MiniC programs (`evaluation/programs/p01…p30.mc`, 15–35 lines each). Each program is one **family**. They are not student code.
- **Generator:** `evaluation/generators/generate_dataset.py`, seed **20261024**, configuration stored in `dataset/manifest.json`.
- **Per program:** 24 single-mutation cases and 6 two-mutation cases. Total **900** cases: 720 single, 180 multi.
- **Mutation categories** (weights): missing `; ) ( } { , ]`, missing operator / identifier / literal / keyword, duplicate delimiter, extra token, invalid character, wrong delimiter (`;`→`,` …), wrong operator (`==`→`=` …), keyword typo (`while`→`whlie`), transposition of adjacent tokens.
- **Validity filter:** each corrupted program is parsed; mutations that still parse are discarded (65), as are duplicate sources (73) and draws with no eligible token (16).
- **Gluing guard:** a deletion that would merge neighbours into one token (`f(x` → `fx`) inserts a space instead. This bug was found during dev analysis and fixed before the test run.
- **Multi-error cases:** two mutations at least 10 tokens apart.

Each case stores: `id, family, split, kind, category, categories, ambiguity, edits[] (op, original token index, removed/inserted text, site, line, column), site, n_errors, original, corrupted, reference_tokens, reference_ast_hash, seed, generator`.

## 2. Splits

Families are shuffled with the seed. **12 programs (40%) form dev (360 cases); 18 programs form test (540 cases).** Splitting by program prevents near-duplicate leakage between splits (enforced by `test_dataset_splits_by_family`).

**Tuning discipline.** Every design change to the evidence model and generators was evaluated with `--split dev`. The model was frozen at commit `03331c0` before the first test-split run. Later commits do not change ranking; a full re-run reproduced every test metric exactly. One caveat: before the freeze, a 60-case smoke run of the pipeline touched cases from two test families. It was used for debugging the harness only; no weights were changed from it.

## 3. Ground truth and ambiguity

The reference is the original program. Correctness is judged on **structure**:

- **Top-1 AST match:** the top plan parses and its canonical AST equals the reference AST (primary metric).
- **Top-1 exact:** the top plan's token sequence equals the reference tokens (stricter; differs e.g. for redundant parentheses).

The mutation does not always determine a unique correct repair. Each case gets an **a-priori ambiguity label** from the mutation alone:

| Label | Mutations | Expectation |
|---|---|---|
| `content-lost` | deleted identifier/literal/keyword, keyword typo | exact recovery is impossible in general (the name is gone); abstaining is the desirable behaviour |
| `operator-choice` | missing or wrong operator | several operators parse; surfacing alternatives is desirable |
| `structural` | everything else | usually one intended repair |

Results are broken down by these labels, so a system is not rewarded only for guessing on ambiguous cases.

## 4. Systems

| ID | System | Notes |
|---|---|---|
| A | raw parser diagnostics | first Bison error; localisation only |
| B | panic-mode recovery | all diagnostics; no repair |
| C | local least-cost repair | same candidate space; cost-only ranking; first-generated tie-break; greedy for later errors; no abstention |
| D | IntelliFix without AST grouping | margin between candidates instead of classes |
| E | IntelliFix without stability evidence | no residual / cascade / completion features |
| F | IntelliFix without abstention | always returns the top plan |
| L | IntelliFix without layout evidence | no layout generators or features (extra ablation) |
| P | IntelliFix (full) | τ chosen on dev |
| G | CPCT+ (optional) | grmtools `nimbleparse` 0.15.0, same grammar productions, same token stream (one token per line), sequence #1 replayed at each error; 2 replicates because ties are broken non-deterministically |

The systems differ in strength: C shares IntelliFix's candidate generator, so C vs P isolates the ranking. G uses its own search, which differs in scope (no substitution, its own cost model) and in purpose (recovery, not intent).

## 5. Metrics

Let *N* be the number of cases in a split. A **failure** (compiler crash or timeout) counts as incorrect and not recommended; none occurred.

| Metric | Definition |
|---|---|
| Top-1 AST | #(top plan valid ∧ AST = reference) / *N* |
| Top-1 exact | #(top plan valid ∧ tokens = reference) / *N* |
| Top-3 AST | #(any of the first 3 plans, from 3 distinct root classes, matches) / *N* |
| Output parses | #(top plan parses) / *N* |
| Coverage | #(status = RECOMMENDED) / *N* (for C and F, every case with a plan) |
| Selective accuracy | #(recommended ∧ correct) / #recommended; selective risk = 1 − selective accuracy |
| Wrong-but-confident rate | #(recommended ∧ ¬correct) / *N* |
| Risk–coverage curve | cases sorted by confidence (tier: complete plan without placeholders; then margin, single class = +∞); risk(k) = errors among the top *k* / *k* |
| AURC | mean over *k* = 1..*N* of risk(k); the **oracle AURC** (all correct cases first) is reported for reference. C has no confidence, so it is ordered by edit cost |
| Localisation | *site* = corrupted-stream token index of the (first) mutation (for a deletion, the gap). A: detection token; C/P/G: the first edit's anchor. Exact: equal; within 1: \|Δ\| ≤ 1; same line |
| Lexical detection | invalid-character cases with ≥ 1 lexical error token / such cases |
| Panic-mode spurious diagnostics | max(0, #diagnostics − #injected errors) per case; mean, and the share of cases with any |
| Cost | candidates generated, AST classes, parser invocations, engine ms (inside parallaxc), end-to-end ms (process wall time including start-up) |
| Calibration error | **not reported**: no probability estimates are produced |

**Uncertainty.** 95% Wilson score intervals for proportions; paired bootstrap (2000 resamples, seed 7) for P − C, P − E, P − L (top-1) and P − F (wrong-confident).

**Threshold selection.** τ ∈ {0, 0.25, …, 4}. Choose the τ with the largest dev coverage whose dev selective risk is ≤ 0.10; fall back to the minimum-risk τ. Selected: **1.5** (dev coverage 45.6%, risk 5.5%). Statuses are re-thresholded offline (only `RECOMMENDED`/`MULTIPLE_PLAUSIBLE` depend on τ), and this is verified against direct `--tau` runs on 25 test cases (25/25 identical). *Audit note (25 Oct 2026): until then a harness bug overwrote this count with the CPCT+ replicate list, so stored results did not actually show it; fixed in `run_experiments.py` (`tau_agree`), and the re-run records 25/25.*

**Timeouts.** 30 s per compiler call in the harness; the engine's own budget (30,000 parses or 4 s) was never exhausted on the benchmark.

## 6. Threats to validity

- **Synthetic errors.** Single-token mutations over-represent simple slips and under-represent real novice errors (misunderstood syntax, many interacting errors, missing whole constructs). No claim about real students is made.
- **Small program pool.** 30 programs written by one author share a style (consistent 2-space indentation). This flatters the layout evidence, which relies on indentation.
- **Weights hand-set on dev.** The dev split was used repeatedly during development, so dev numbers are optimistic; only the test numbers are reported as estimates.
- **AST match as correctness.** It ignores formatting and parentheses but treats `a+b` and `b+a` as different. For `content-lost` cases it is unattainable by design.
- **Baseline fairness.** C shares IntelliFix's generator, a conservative comparison that isolates ranking. G is a different algorithm with a different objective; it is run through our replay of its first repair sequence, an approach we document but cannot fully verify against grmtools internals.
- **Multiple comparisons.** Several metrics and ablations are reported; small differences (H4, H5) should not be over-read.
