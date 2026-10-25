# Contribution and impact

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


## What was implemented

| Area | Implemented |
|---|---|
| Compiler | re-entrant Flex lexer; pure Bison LALR(1) parser with LAC and custom diagnostics; panic-mode recovery; arena-owned AST; canonical form and hash; name/scope/arity resolution; `parallaxc` CLI with deterministic JSON |
| Repair engine | grammar-guided window generation; layout generators; cost-2 search; two-level validation (token + source round trip); 13-feature evidence model; AST grouping; hypothesis lanes; stability; 7-status decision policy; budgets |
| Evaluation | seeded benchmark (900 cases, family split); systems A–F, L, P and the real CPCT+ (G); Wilson CIs, paired bootstrap, risk–coverage/AURC; generated reports; executable error catalog (61 cases) |
| Backend | FastAPI with 15 endpoints, typed errors, sandboxed subprocesses, LR state reports, AST diff, live mini-evaluation, docs |
| Frontend | 10 views + guided demo; CodeMirror editor; byte-exact highlights; evidence bars; class, rejection and comparison views; lanes; charts with table alternatives; dark mode; responsive |
| Documentation | 21 Markdown documents (this folder) + README |

## How impact is measured

On a held-out split, with uncertainty: top-1/top-3 AST recovery, wrong-but-confident rate, coverage, selective accuracy, AURC, localisation and cost (EVALUATION_PROTOCOL.md).

## Evidence obtained (test split)

| Claim | Evidence | Strength |
|---|---|---|
| Evidence ranking beats cost-only ranking | 71.5% vs 55.2% top-1; +16.3 pts, CI [13.1, 19.4] | strong |
| Layout evidence matters | +8.9 pts, CI [6.7, 11.3]; missing `{`/`}` 100% vs 38–43% | strong (benchmark has consistent indentation) |
| Abstention reduces confident errors | 6.1% vs 28.5%, difference CI [−25.9, −18.9] at 50.7% coverage | strong |
| Repairs localise errors better than detection points | 86.7% vs 76.3% exact | moderate |
| AST grouping improves coverage | +1.8 pts coverage; AURC 0.139 vs 0.143 | weak |
| Stability evidence improves ranking | +0.2 pts, CI [−0.4, 0.9] | **not supported** |
| τ from dev controls risk on test | 12.0% vs 10% target | **not supported** |

## What remains unproven

Benefit for real learners; generalisation beyond synthetic single/double token mutations; semantic correctness of repairs; superiority over CPCT+ on its own objective.

## Feature → test traceability

| Feature | Tests |
|---|---|
| token positions, CRLF, Unicode | `lexer_positions_*`, `lexer_crlf_*`, `lexer_unicode_*`, `lib.test.ts` (OffsetMap) |
| lexical errors | `lexer_malformed_numbers`, `lexer_char_literals`, `lexer_invalid_characters`, catalog L01–L16 |
| grammar precedence / dangling else | `parser_precedence_and_associativity`, `parser_dangling_else_binds_to_nearest_if` |
| exact expected tokens | `parser_expected_tokens_are_exact`, `parser_expected_at_probe`, `test_parse_error_has_expected_tokens_and_state` |
| panic-mode recovery | `parser_panic_mode_recovers_multiple_errors` |
| re-entrancy / concurrency | `parser_is_reentrant_across_threads`, `test_concurrent_requests_do_not_interfere` |
| resource limits | `parser_deep_nesting_*`, `repair_budget_exhaustion_is_explicit`, `test_oversized_input`, `test_timeout_is_504` |
| AST canonical equality | `parser_parentheses_do_not_appear_in_ast`, `parser_formatting_does_not_change_structure`, `test_compare_equivalent_and_different` |
| source reconstruction | `repair_identity_reconstruction_is_exact`, `repair_reconstruction_*` |
| parser validation of candidates | `repair_every_accepted_candidate_is_parser_validated` |
| deferred / duplicate detection | `repair_detects_deferred_errors_and_duplicates`, catalog R09/R10 |
| evidence: layout, names, arity | `repair_indentation_evidence_prefers_structural_brace`, `repair_missing_comma_prefers_matching_arity`, `names_*` |
| grouping | `repair_ast_grouping_merges_equivalent_candidates`, catalog R05 |
| lanes and stability | `repair_multiple_errors_produce_a_multi_step_plan` |
| statuses | `repair_*_is_recommended`, `…multiple_plausible`, `…low_confidence`, `…unsupported…`, `repair_empty_input_is_valid`, catalog |
| ablation switches | `repair_no_abstention_forces_recommendation`, `repair_least_cost_baseline_uses_cost_only`, `test_repair_options_change_behaviour` |
| determinism | `repair_is_deterministic`, `test_dataset_generation_is_reproducible` |
| metrics | `evaluation/tests/test_metrics.py` |
| API contract and errors | `backend/tests/test_api.py` |
| UI behaviour | `frontend/tests/unit/*.test.*`, `tests/e2e/run-e2e.mjs` |

## Feature → evidence table

| Feature | Where to see it working | Measured effect |
|---|---|---|
| grammar-guided generation | Repair lab: candidates, `generator` column | basis of all systems C–P |
| layout generators and features | sample 04, Repair lab evidence | +8.9 pts top-1 (ablation L) |
| two-level validation | “Source change … verified” note; Rejected tab | by construction a candidate that fails the round trip is rejected (`malformed`) and can never be recommended; counts are reported per run |
| evidence model | evidence bars, “Why rank …” | +16.3 pts vs C |
| AST grouping | sample 12, Classes tab | small coverage gain |
| hypothesis lanes / stability | sample 06, Hypothesis explorer | top-1 on two-error cases 52.8% vs 31.5% (C); stability features ≈ 0 effect |
| abstention | samples 04, 05, 07, 08 | −22.4 pts wrong-confident |
