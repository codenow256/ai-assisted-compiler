# IntelliFix — capability matrix

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


**Status key**
- **Implemented**: built, and exercised by executed tests in this environment.
- **Partial**: works, with a stated gap.
- **Blocked**: cannot be verified here; the reason is given.
- **Untested**: code exists but has not been executed.
- **Planned**: not built.
- **Out of scope**: deliberately not done.

Evidence was last run on 25 Oct 2026. Re-run all layers with `./scripts/test_all.sh`.

## 1. Compiler front end

| Capability | Status | Evidence |
|---|---|---|
| Flex lexer: re-entrant; exact line, column and byte-offset spans; comments kept as trivia | Implemented | `compiler/tests/test_lexer.cpp`; catalog L01–L16 |
| Lexical errors as tokens with messages (invalid character, malformed or out-of-range numbers, unterminated comment or char, non-ASCII, control characters, identifiers longer than 255) | Implemented | catalog; professor cases P43–P46, P73–P85 |
| C constructs recognised and labelled `UNSUPPORTED` (`++`, `+=`, `?:`, `#include`, strings, `switch`, `do`, `struct`, …) | Implemented | P18, P64–P71 |
| Bison LALR(1) parser: pure, `%expect 0`, 97 rules, 168 states | Implemented | `compiler/build/parser.output`; GRAMMAR_AND_PARSER.md |
| Exact expected-token sets at an error (LAC) | Implemented | `parser.cpp` tests; Grammar & parsing page |
| Panic-mode recovery (`error` productions) with all diagnostics | Implemented | baseline B in the evaluation |
| AST in an arena with canonical form and hash | Implemented | AST_AND_REPRESENTATIONS.md; `test_parser.cpp` |
| Name, scope and arity warnings (repair evidence only, not a type checker) | Implemented | `names.cpp`; P21 |
| Parser stack-limit handling (about 2500 nested blocks or 5000 parentheses) | Implemented | P58, P86; regression test `repair_parser_nesting_limit_is_reported_not_repaired` |
| Semantic analysis or type checking | Out of scope | KNOWN_LIMITATIONS.md |
| Code generation or execution | Out of scope | — |

## 2. Repair engine

| Capability | Status | Evidence |
|---|---|---|
| Bounded candidate generation: window, layout generators, cost-2 search | Implemented | REPAIR_ALGORITHM.md §3; `test_repair.cpp` |
| Two-level validation: token parse, then source round trip | Implemented | fuzzing invariant "candidates marked parser-valid re-parse": 800 inputs, 0 violations |
| 13-feature interpretable evidence model, weights frozen on dev | Implemented | Repair laboratory → Evidence breakdown |
| AST equivalence classes | Implemented | `repair_ast_grouping_merges_equivalent_candidates` |
| Hypothesis lanes (3 roots × 2 branches, depth 4, 12 leaves) and stability report | Implemented | Hypothesis explorer; P47, P48 |
| Seven decision statuses with stated reasons | Implemented | catalog and professor cases: six statuses occur with default settings; `BUDGET_EXHAUSTED` only with a deliberately reduced budget (catalog R07), never on the 900-case benchmark |
| Abstention threshold τ = 1.5, selected on dev | Implemented | EVALUATION_PROTOCOL.md §5 |
| Never recommend discarding code hidden in an unterminated comment | Implemented (25 Oct) | P73; `repair_never_recommends_discarding_an_unterminated_comment` |
| Repairs needing 3 or more edits at one site | Out of scope (bounded) | catalog S33/S34 → `NO_SAFE_REPAIR` |
| Telling a valid but unintended repair apart (e.g. `whlie (…)` becomes a call) | **Partial**: name warnings are evidence, but too weak in these cases | P41, P62; KNOWN_LIMITATIONS.md |
| Calibrated probabilities | Planned (not attempted) | the margin is a score difference |

## 3. Backend (FastAPI)

| Capability | Status | Evidence |
|---|---|---|
| `/api/lex`, `/parse`, `/analyze`, `/repair`, `/repair/compare` | Implemented | `backend/tests/test_api.py` (32 tests) |
| `/api/grammar`, `/grammar/state/{n}`, `/docs`, `/evaluation/results`, `/evaluation/case/{id}`, `/evaluate` (live sample) | Implemented | same |
| Health check with an exact build hint when the compiler is missing | Implemented | screenshot `18-compiler-not-built.png` |
| Input limit 64 KB (HTTP 413), timeout (504), crash and garbage output (500), concurrency limit | Implemented | API tests; professor H02, H04 |
| Finds `parallaxc.exe` in `build\` or `build\Release\` on Windows | Implemented, Linux-tested logic | `config.locate_compiler`; Windows not executed |
| Subprocess launched from a worker thread (works with every Windows event loop) | Implemented | API tests on Linux; Windows not executed |
| Swagger UI under `/api/swagger` | Implemented | `test_ui_docs_route_is_not_shadowed_by_swagger` |

## 4. Web interface

| Capability | Status | Evidence |
|---|---|---|
| Plain-language explanation for every result state (valid, empty, syntax error, lexical error, unsupported C, nesting limit, cascades, each decision status) | Implemented (final round) | `tests/unit/explain.test.ts`: 102 tests over all 88 professor-style inputs with real compiler responses |
| Interactive ambiguity resolution (real plans or a user fill-in, parser-checked, apply + re-analyze, undo) | Implemented | unit; E2E “ambiguity: the user fills in the missing expression…” |
| Progressive hints and “Check my fix” for student attempts | Implemented | E2E “student practice” |
| Explained AST explorer: plain-language node details, child roles, source text, search, expand/collapse all, partial tree for invalid code, AST of the top repair (labelled) | Implemented | E2E (2 steps); unit (every node kind explained) |
| Before/after AST with change marks from the compiler's structural diff | Implemented (both sides need a complete AST; otherwise a labelled partial-vs-complete view without marks) | E2E |
| Plan comparison table with “Use this” | Implemented | workbench; accept flow covered by E2E |
| Usability or learning benefit for students | **Not measured** (study proposed in IntelliFix_Interactive_Features.md) | — |
| Workbench: editor, samples, Open, Reset, Clear, Undo; Run lexer, Run parser, Repair suggestions, Analyze | Implemented | `frontend/tests/unit/app.test.tsx` (26 tests); screenshots 02–05 |
| Per-run result rows with a current/earlier-text badge | Implemented (fixed 25 Oct: lexer and parser results were not shown on the workbench) | test "Run lexer and Run parser show their results…" |
| Lexical analysis, Grammar & parsing (LR state, items, actions), AST explorer, Repair laboratory, Hypothesis explorer, Evaluation & impact, Learning center, Documentation | Implemented | screenshots 06–17 |
| Accept repair / Undo; compare two candidates | Implemented | unit tests |
| Draft kept across page refresh; dark mode; Ctrl+Enter | Implemented | E2E refresh check |
| Code shown without ligatures (`<=` never rendered as `≤`) | Implemented (fixed 25 Oct in the editor and in diffs) | screenshot 09b |
| End-to-end browser test (Playwright, Chromium) | Implemented; re-run in final QC | `frontend/tests/e2e/run-e2e.mjs` |
| Other browsers (Firefox, Safari, Edge) | Untested | — |
| Mobile layout | Partial: renders, not designed for it | — |

## 5. Platforms

| Platform | Status | Evidence |
|---|---|---|
| Linux (Ubuntu, g++, Bison 3.8.2, Flex 2.6.4) | Implemented | all test layers |
| Windows binary cross-compiled with MinGW-w64, run under Wine 9.0 | Implemented | 68/68 C++ tests; catalog identical to Linux |
| Windows native: MSVC build | **Blocked**: no MSVC here | INSTALLATION_AND_TROUBLESHOOTING.md §3 |
| Windows native: running on a real machine; PowerShell scripts | **Untested** | `scripts/windows/*.ps1` written, not executed |
| macOS | Untested | — |

## 6. Evaluation

| Capability | Status | Evidence |
|---|---|---|
| Seeded benchmark of 900 cases with a family-level dev/test split | Implemented | IntelliFix_Evaluation_and_Reproducibility.md §2 |
| Systems A–F, L, P; Wilson intervals; paired bootstrap; risk–coverage and AURC | Implemented | `evaluation/results/summary.json` |
| CPCT+ baseline (grmtools nimbleparse 0.15.0) | Implemented when nimbleparse is installed; nondeterministic | §4 of the audit |
| Error catalog (61 cases) and professor-style suite (88 cases + 800 fuzz inputs + 7 HTTP sequences) | Implemented | ERROR_CATALOG_RESULTS.md, IntelliFix_Random_Input_Test_Report.md |
| Study with real student programs | Planned (not done) | — |
