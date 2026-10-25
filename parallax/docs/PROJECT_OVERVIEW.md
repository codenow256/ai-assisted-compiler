# Project overview

## Abstract

Compilers report syntax errors where the parser *detects* them, which is often not where the programmer made the mistake. When they suggest a fix, they usually commit to one candidate without saying how strong the evidence is. **IntelliFix** is a syntax-repair system for MiniC, a C-like teaching language, built on a Flex lexer and a Bison LALR(1) parser. For every syntax error it generates a bounded set of local repair candidates guided by the parser's exact expected-token sets and by layout cues. It validates each candidate by re-lexing and re-parsing reconstructed source, then ranks the candidates with an interpretable linear evidence model. Candidates that yield the same abstract syntax tree are grouped. The strongest hypotheses are extended to repair later errors, and the follow-on diagnostics are compared across hypotheses. IntelliFix recommends a repair only when it beats every structurally different alternative by a margin τ chosen on a development split; otherwise it lists alternatives or abstains. On a held-out set of 540 seeded mutations of hand-written programs, IntelliFix's top-ranked repair restores the original AST in 71.5% of cases, against 55.2% for a least-cost local repair baseline and about 47–49% for CPCT+ (grmtools; it varies between runs because CPCT+ breaks ties arbitrarily). With abstention, 6.1% of all cases receive a wrong confident recommendation, against 28.5% when the top candidate is always returned, at 50.7% coverage. The follow-on stability evidence produced no measurable gain, and the dev-tuned threshold did not fully transfer to test (12.0% selective risk against a 10% target). Both are reported as negative results.

## Problem statement

Given a MiniC program that the parser rejects:

1. **Detection is not localisation.** The parser fails at the first token that cannot continue any rule. A missing `;` is detected on the next line; a missing `{` may be detected many lines later.
2. **Many repairs are grammatical.** For `int c = a b;`, inserting any of 14 binary operators produces a valid program. A parser can confirm validity but not intent.
3. **Commitment without evidence misleads.** A tool that always picks one repair is wrong with confidence whenever the evidence is weak or ambiguous.
4. **Errors interact.** With several errors, the choice of the first repair changes which later errors appear.

## Objectives

| # | Objective | Where it is met |
|---|---|---|
| O1 | Correct, well-tested Flex/Bison/C++ front end for a precisely specified language | `compiler/`, `docs/MINIC_LANGUAGE_SPEC.md` |
| O2 | Multi-candidate repair with real parser validation | `compiler/src/repair_engine.cpp` |
| O3 | Interpretable evidence ranking and AST grouping | same; Repair laboratory UI |
| O4 | Follow-on diagnostics across hypotheses | hypothesis lanes, stability table |
| O5 | Explicit, inspectable abstention statuses | `Engine::decide`, Workbench/Repair UI |
| O6 | Reproducible evaluation with baselines, ablations and uncertainty | `evaluation/` |
| O7 | A workbench that exposes the internals to non-experts | `frontend/` |
| O8 | Honest documentation of results and limits | `docs/` |

## Scope

**In scope:** lexical analysis, parsing, AST construction, name resolution used as repair evidence, syntax-error localisation and repair, evaluation, and the visualisation of all of these.

**Out of scope:** type checking, semantic analysis beyond name/arity checks, code generation and optimisation. IntelliFix never claims a repaired program is semantically correct.

## Target users

- **Students** learning how compilers detect and recover from errors.
- **Instructors and examiners** who want a transparent tool whose decisions can be inspected.
- **Researchers** studying error recovery, who can reproduce the evaluation and the ablations.

## Methodology

1. Specify MiniC; implement and test the lexer, the grammar (`%expect 0`) and the AST.
2. Implement the repair pipeline as separate stages: localise → generate → validate → analyse → score → group → lanes → decide.
3. Build a benchmark generator with seeded mutations, splitting by source program into dev (40%) and test (60%).
4. Develop the evidence model on dev only, then freeze it (commit `03331c0`) and evaluate once on test.
5. Compare against diagnostic baselines, a least-cost baseline, ablations and CPCT+.
6. Report all metrics with 95% Wilson intervals and paired bootstrap differences, including the negative results.

## System requirements

- Linux or macOS (Windows through WSL2). About 300 MB of disk including `node_modules`.
- Build tools: C++17 compiler, CMake ≥ 3.16, Bison ≥ 3.6, Flex ≥ 2.6.
- Python ≥ 3.10 with FastAPI, Uvicorn and Pydantic 2; Node ≥ 18 (22 tested).
- Runtime limits: 64 KB input, 15 s compiler timeout, 4 concurrent compiler processes, 30,000 parser invocations or 4 s per repair.

## Contribution in one sentence

An integrated, inspectable, empirically evaluated pipeline that combines established techniques (local repair, parser validation, structural equivalence and selective prediction) and measures where each one helps and where it does not. See [RESEARCH_POSITIONING.md](RESEARCH_POSITIONING.md).
