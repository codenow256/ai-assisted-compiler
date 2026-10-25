# Viva preparation

Each answer has five parts: **A** a short answer for the viva · **T** the technical detail · **F** the file(s) · **E** the evidence · **L** limits and caveats.

### 1. What exactly is the research contribution?
**A** An integrated, inspectable pipeline that generates several syntax repairs, validates each with the real parser, ranks them with interpretable evidence, groups them by AST, explores follow-on errors, and abstains when the evidence is weak. It is evaluated against baselines and ablations. **T** See RESEARCH_POSITIONING §4. **F** `repair_engine.cpp`, `evaluation/`. **E** test split: top-1 +16.3 pts over least-cost (CI 13.1–19.4); wrong-confident 6.1% vs 28.5%. **L** No single technique is new; the claims are about integration and measurement on synthetic data.

### 2. How is this different from ordinary Bison error reporting?
**A** Bison reports where it got stuck and which tokens it expected. IntelliFix uses that information to propose, validate and compare repairs, and decides whether one deserves a recommendation. **T** LAC expected sets drive generation; panic mode is one baseline. **F** `minic.y`. **E** baseline A localises exactly in 76.3% of cases, IntelliFix's first edit in 86.7%. **L** IntelliFix costs about 300 parses per error, versus 1.

### 3. Panic mode vs local repair?
**A** Panic mode throws tokens away until it can resynchronise. It reports errors but never fixes them, and it creates cascades. Local repair edits a few tokens so parsing can continue. **T** `error ';'` / `error '}'` productions vs insert/delete/replace with a progress check. **E** B reports 3.85 diagnostics per case for 1–2 real errors; 61% of cases have spurious ones. **L** Local repair can choose a wrong but cheap fix.

### 4. What is the relationship to CPCT+?
**A** CPCT+ (Diekmann & Tratt, ECOOP 2020) finds the complete set of minimum-cost repair sequences at an error and picks one. IntelliFix shares the local-repair idea but ranks candidates with extra evidence and can decline to choose. We ran the real CPCT+ (grmtools `nimbleparse` 0.15.0) as baseline G. **T** Same productions and token stream; we replay its first sequence. **F** `evaluation/baselines/cpctplus_adapter.py`. **E** G top-1 about 47–49% (it varies between runs); its two replicates agree on only 68.6–70.1% of cases (ties are broken arbitrarily). **L** CPCT+ is designed for recovery (fewer cascades), not intent; we did not measure that.

### 5. Why are multiple candidates necessary?
**A** Because many edits make a program parse, and the cheapest is often wrong. **E** For `int c = a b;` there are 20 distinct valid ASTs at cost 1. The least-cost baseline is right 55% of the time; evidence ranking over the same candidates 71.5%. **F** `repair_ambiguous_operator_is_multiple_plausible`.

### 6. Why isn't parser validity proof of intended meaning?
**A** The grammar accepts many programs; validity says nothing about which one was meant. **E** `int = 5;` parses after inventing `__hole`, so IntelliFix reports LOW_CONFIDENCE; deleting `while` makes `(b != 0) {…}` parse after inserting `;`, a known false-confident failure. **L** A semantic check would catch some of these; MiniC has none beyond names.

### 7. How is the repair cost calculated?
**A** Insert 1, delete 1, replace 1.5 (one local change, but it both removes and invents a token). **F** `edit_cost` in `repair_stream.cpp`. **L** The weights are a design choice; cost is only one feature of the score.

### 8. How are candidate edits generated?
**A** At the error and up to 3 tokens before it, IntelliFix asks the parser which tokens it would accept (an exact LAC probe), then tries inserting, deleting or replacing with those tokens. Layout generators reach further back for line-end `;`, braces at indentation changes and doubled delimiters. Pairs of edits are tried only if no single edit works. **F** `generate_step`. **E** about 100 candidates per case on average. **L** Bounded: ≥ 3 edits at one site are out of scope (catalog S33/S34).

### 9. How is each candidate validated?
**A** Twice. The edited token stream is parsed; then the source is rebuilt from it with the original whitespace and comments, re-lexed (it must reproduce exactly the edited tokens) and re-parsed. **F** `classify`, `analyse`. **E** test `repair_every_accepted_candidate_is_parser_validated`. **L** The validation is syntactic only.

### 10. AST vs parse tree?
**A** The parse tree records every grammar rule and token; the AST keeps only meaningful structure. Parentheses and semicolons disappear, and precedence becomes tree shape. **F** `ast.hpp`; UI “Parse progression” vs AST explorer.

### 11. How are equivalent ASTs identified?
**A** By equality of a canonical serialisation: kinds, attributes and children in order, with spans excluded. Full strings are compared; the hash is only for display. **E** `(a) + 2` and `(a + 2)` form one class (test `repair_ast_grouping_merges_equivalent_candidates`). **L** No algebraic normalisation (`a+b` ≠ `b+a`).

### 12. How do you avoid picking the first valid candidate blindly?
**A** All candidates are scored with the same evidence model; ties go to lower cost, then generation order. A recommendation also needs a margin ≥ τ over every structurally different alternative. **E** Baseline C does pick by cost and order, and loses 16 points.

### 13. Why evidence ranking instead of a single edit cost?
**A** Cost cannot tell `;` from `,` or a correct `{` from deleting a later `}`. Layout, names, arity and residual errors can. **E** Without layout evidence top-1 drops 8.9 points; arity fixes the missing-comma category (100% vs 38%).

### 14. What does diagnostic stability mean?
**A** For each explored hypothesis about the first error, IntelliFix repairs the later errors and records where they occur. A later error site found under every explored hypothesis is “stable across the tested hypotheses”. **F** `compute_stability`. **L** It is evidence, not proof of independence; only up to 3 hypotheses are explored.

### 15. What can make a later error appear or disappear?
**A** The first repair changes the parser's state for everything after it. Deleting `if` turns `(s > 10 {` into a call-like expression with different errors; inserting `;` leaves the `if` intact. Panic mode can also invent cascades by resynchronising in the wrong place.

### 16. Why is abstention a feature?
**A** A wrong confident fix misleads the learner. When evidence is weak, IntelliFix ranks alternatives but does not choose. **E** Wrong-confident falls from 28.5% to 6.1% (CI of the difference −25.9 to −18.9 points) at 50.7% coverage.

### 17. How is confidence calibrated?
**A** It isn't calibrated to probabilities, and we say so. The decision uses a score margin and a threshold τ chosen on the dev split for ≤ 10% selective risk. **E** τ = 1.5; dev risk 5.5%; test risk 12.0% (did not fully transfer). **L** No probability or ECE claims.

### 18. Confidence vs parser validity?
**A** Validity: the parser accepts the repaired program. Confidence: no structurally different repair has comparable evidence, nothing is invented, and every later error was also repaired. **E** 08_abstain_missing_name is valid but LOW_CONFIDENCE.

### 19. How was the dataset generated?
**A** 30 valid hand-written programs, seeded token mutations (18 categories), 24 single and 6 double per program; mutations that still parse are discarded. **F** `generate_dataset.py`; seed 20261024. **E** regenerating gives identical bytes (`test_dataset_generation_is_reproducible`).

### 20. How do you prevent train/test leakage?
**A** Splits are by program, not by mutation: 12 dev programs and 18 test programs. Weights and τ came from dev only, and the model was frozen before the test run. **E** `test_dataset_splits_by_family`; commit `03331c0`. **L** A 60-case smoke run touched two test families before the freeze (no tuning from it).

### 21. What are the limitations of synthetic errors?
**A** They are mostly single-token slips in tidy code by one author. Real novice errors are messier, and our layout evidence benefits from consistent indentation. No claim about real students is made.

### 22. Which baselines are genuinely implemented?
**A** All of A–F and L run through the real compiler. G (CPCT+) runs the real external tool. None is simulated. **F** `systems.py`.

### 23. What happens when two repairs are equally plausible?
**A** If they produce different ASTs, the margin is below τ and the status is MULTIPLE_PLAUSIBLE; both are shown. If they produce the same AST, they are one class and do not compete.

### 24. Multiple errors?
**A** Hypothesis lanes repair errors one at a time (up to 4 steps, 12 leaves). The plan contains all edits, and the margin must hold at every step. **E** two-error cases: top-1 52.8% vs 31.5% for least-cost. **L** Interacting or many errors can exceed the bounds; the status becomes LOW_CONFIDENCE or BUDGET_EXHAUSTED.

### 25. How do you know a repair hasn't just moved the error?
**A** A candidate is accepted only if parsing continues at least 3 tokens past the edit **and** past the original error point; otherwise it is rejected as `defers-error`. **E** catalog R09; UI Rejected tab.

### 26. How do you measure impact?
**A** Top-1/top-3 AST recovery, coverage, selective accuracy, wrong-confident rate, AURC, localisation and cost, with Wilson CIs and paired bootstrap. **F** EVALUATION_PROTOCOL.md.

### 27. Which results are statistically reliable?
**A** The large effects: P vs C (+16 pts), P vs L (+9 pts), P vs F on wrong-confident (−22 pts); all CIs exclude 0. Grouping (+1.8 coverage points) and stability (+0.2) are within noise. Per-category numbers with small *n* are indicative only.

### 28. What are the main failure cases?
**A** Missing keywords, keyword typos and transpositions, where a cheap valid repair changes meaning (25–27% wrong-confident in those categories), and content-lost cases, where the original cannot be known.

### 29. Why Flex and Bison?
**A** They are standard, well documented, and fit the course. Bison provides LAC for exact expected tokens, structured custom errors, a pure parser for thousands of re-parses, and a state report we can show.

### 30. Why FastAPI?
**A** Typed request validation (Pydantic), async subprocess orchestration with timeouts, automatic OpenAPI docs, and it reuses the Python evaluation code for live runs.

### 31. Why is Rust optional?
**A** It is needed only for the CPCT+ baseline. The core must build with a plain C++ toolchain; the adapter reports its availability and never fakes output.

### 32. What happens when a dependency is unavailable?
**A** Missing compiler → HTTP 503 with the build command; backend down → UI banner with the start command; Flex/Bison missing → CMake fails clearly; no `nimbleparse` → G reported as not run. **E** `test_missing_compiler_is_503`, the offline UI test.

### 33. What is the time complexity of the bounded search?
**A** O(*w*·*k*) candidate parses per step, each O(*n*), with *w* = 4 positions and *k* ≤ 25 expected kinds, plus at most 12 seeds × O(*k*) for pairs, times at most 12 lane leaves; hard-capped at 30,000 parses or 4 s. **E** mean 306 parses per case (deterministic) and about 10–14 ms engine time (depends on machine load).

### 34. How are resource limits enforced?
**A** In the engine (parse and time budget, window, depth, leaves), in the parser (5000-entry stack), in the CLI and API (64 KB input, 1 MB body) and in the backend (15 s timeout with kill, 4 concurrent processes).

### 35. How do you ensure reproducibility?
**A** Seeded generation, deterministic engine (tie-breaks; test `repair_is_deterministic`), recorded environment and commit, pinned dependencies, one script per step. **E** A re-run reproduced every IntelliFix metric exactly. **L** CPCT+ is non-deterministic, hence two replicates.

### 36. Which parts are established and which are IntelliFix's?
**A** Established: panic mode, local insert/delete/replace repair with a progress check, LAC, AST equality, selective prediction. IntelliFix's: their combination, the layout/name/indentation evidence, AST-class margins, hypothesis lanes with stability reporting, the abstention policy, and the evaluation and UI.

### 37. What would you change with more time?
**A** Real student data; learned or cross-validated weights with calibration; a larger dev set for τ; semantic checks (types) as evidence; wider search (cost 3) using CPCT+-style search; a user study; macOS/Windows CI.
