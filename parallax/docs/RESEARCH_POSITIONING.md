# Research positioning

## 1. The problem

Syntax error handling has three sub-problems: **detection** (the parser cannot continue), **localisation** (where the mistake is) and **correction** (what the programmer meant). LR parsers with the correct-prefix property detect an error at the first token that cannot extend any valid prefix. Localisation and correction are underdetermined: many edits make a program parse, and the cheapest one is not necessarily the intended one.

## 2. Established approaches

The references were checked against publisher pages or official repositories on 2026-10-24 (links below). Items marked *(background)* are standard textbook material and were not re-verified.

| Approach | Idea | Representative work |
|---|---|---|
| Panic-mode recovery | discard input until a synchronising token, pop to a state that can handle `error` | standard textbook technique *(background)*; Bison's `error` token (GNU Bison manual) |
| Minimum-distance correction | find the valid string with the fewest insertions, deletions and substitutions | Aho & Peterson, *A Minimum Distance Error-Correcting Parser for Context-Free Languages*, SIAM J. Computing 1(4), 1972 — [doi:10.1137/0201022](https://epubs.siam.org/doi/10.1137/0201022) |
| Local / phrase-level LR repair with deferred actions | try bounded edits near the error, accept those that let parsing continue | Burke & Fisher, *A practical method for LR and LL syntactic error diagnosis and recovery*, ACM TOPLAS 9(2):164–197, 1987 — [IBM Research record](https://research.ibm.com/publications/a-practical-method-for-lr-and-ll-syntactic-error-diagnosis-and-recovery) |
| Insert/delete/shift search at the error point | Corchuelo, Pérez, Ruiz-Cortés & Toro, *Repairing Syntax Errors in LR Parsers*, ACM TOPLAS 24(6):698–710, 2002 — [repository record](https://idus.us.es/handle/11441/65631) |
| CPCT+: complete set of minimum-cost repair sequences | report all minimum-cost repair sequences at an error location, reducing cascading errors | Diekmann & Tratt, *Don't Panic! Better, Fewer, Syntax Errors for LR Parsers*, ECOOP 2020, LIPIcs 166, 6:1–6:32 — [doi:10.4230/LIPIcs.ECOOP.2020.6](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2020.6), [arXiv:1804.07133](https://arxiv.org/abs/1804.07133); implementation in grmtools (`lrpar`, `nimbleparse`) |
| Exact expected tokens in LR parsers | LAC (lookahead correction) avoids incorrect expected-token lists caused by default reductions and state merging | GNU Bison manual, [§ LAC](https://www.gnu.org/software/bison/manual/html_node/LAC.html) (Joel E. Denny) |
| Error-state coverage for diagnostics | enumerate LR error states and minimal inputs that reach them | Pottier, *Reachability and error diagnosis in LR(1) automata*, JFLA 2016 — [HAL](https://hal-univ-tlse3.archives-ouvertes.fr/INRIA/hal-01248101v1). (The venue is JFLA, not Compiler Construction as first recalled; corrected after checking.) |
| Learned repair | neural models predict fixes; a compiler checks them | Gupta, Pal, Kanade & Shevade, *DeepFix*, AAAI 2017 — [doi:10.1609/aaai.v31i1.10742](https://ojs.aaai.org/index.php/AAAI/article/view/10742) |
| Neurosymbolic repair | a neural model selects error-correction rules; a symbolic error-correcting parser produces repairs | Sakkas et al., *Seq2Parse: Neurosymbolic Parse Error Repair*, PACMPL 6(OOPSLA2), 2022 — [doi:10.1145/3563330](https://api.crossref.org/works/10.1145%2F3563330) |
| Selective prediction / reject option | abstain when unsure; evaluate with risk–coverage curves | El-Yaniv & Wiener, *On the Foundations of Noise-free Selective Classification*, JMLR 11:1605–1641, 2010 — [JMLR](https://jmlr.org/papers/v11/el-yaniv10a.html); Geifman & El-Yaniv, *Selective Classification for Deep Neural Networks*, NeurIPS 2017 — [arXiv:1705.08500](https://arxiv.org/abs/1705.08500) |
| Binomial confidence intervals | Wilson score interval *(background)* | Wilson, JASA 1927 |

## 3. What IntelliFix inherits

- **Local repair with a progress criterion** (accept an edit if parsing continues N tokens past it) comes from the Burke–Fisher and Corchuelo et al. family; IntelliFix uses N = 3.
- **Insert/delete/replace edit operations with costs** come from minimum-distance repair.
- **Grammar-guided candidate vocabularies** use Bison's LAC to obtain exact expected tokens at any prefix position.
- **Panic-mode recovery** (Bison `error` productions) is used both as a baseline and to count residual diagnostics.
- **Risk–coverage evaluation and AURC** come from selective classification.

## 4. What IntelliFix integrates (engineering contribution)

The following combination, as one inspectable and tested pipeline, is what IntelliFix adds:

1. Multi-candidate local generation guided by exact LAC expected sets, with **layout-informed generators** that reach further back (line-end `;`, brace insertion at indentation changes, doubled delimiters).
2. **Two-level validation**: token-level parsing, then **source round-trip** (rebuild text with the user's original whitespace and comments, re-lex, check equality with the edited stream, re-parse). A token-index edit therefore cannot land at a wrong source position unnoticed.
3. An **interpretable evidence model** with 13 named features, including AST-level indentation consistency and name/arity resolution of the repaired program.
4. **AST equivalence classes**, so that equivalent repairs (`(a) + 2` and `(a + 2)`) do not count as competing alternatives.
5. **Hypothesis lanes** that repair later errors under each of the top first-error hypotheses, plus a *stability* report of follow-on diagnostic sites.
6. **Confidence-aware abstention** with seven explicit statuses and a margin threshold chosen on dev data.
7. A **workbench** that shows every stage with real data, and a **reproducible evaluation** with ablations and a real CPCT+ run.

None of these ideas is claimed to be individually new.

## 5. Empirical hypotheses

These hypotheses motivated the design. The metrics, the dev/test split and the frozen model were fixed before the first test run; this document itself was written afterwards, so it records the hypotheses rather than pre-registering them.

- **H1** Evidence ranking beats cost-only ranking on top-1 AST recovery over the same candidate space.
- **H2** Layout evidence (line ends, indentation) improves top-1 for structural errors.
- **H3** Abstention lowers the rate of wrong confident recommendations at an acceptable coverage.
- **H4** AST grouping improves the risk–coverage trade-off, because equivalent candidates no longer shrink the margin.
- **H5** Follow-on stability evidence improves ranking for multi-error inputs.

## 6. What would count as evidence

Paired differences on the **held-out test split** with confidence intervals that exclude 0 (H1, H2, H5); a lower wrong-confident rate at a stated coverage (H3); and a lower AURC or a higher coverage at equal risk (H4).

## 7. What was found (test split; details in RESULTS_AND_IMPACT.md)

| Hypothesis | Outcome |
|---|---|
| H1 | **Supported.** +16.3 points top-1 vs least-cost, 95% CI [13.1, 19.4]. |
| H2 | **Supported.** +8.9 points top-1 vs the no-layout ablation, CI [6.7, 11.3]. |
| H3 | **Supported, with a caveat.** Wrong confident: 6.1% vs 28.5% (difference −22.4 points, CI [−25.9, −18.9]) at 50.7% coverage. Selective risk 12.0% exceeded the 10% dev target. |
| H4 | **Weak.** Coverage 50.7% vs 48.9% at the same wrong-confident rate; AURC 0.139 vs 0.143. Small effect. |
| H5 | **Not supported.** +0.2 points, CI [−0.4, 0.9]. |

## 8. What IntelliFix cannot claim

- That any individual technique is novel.
- That a recommended repair is what the programmer intended, or that it is semantically correct.
- That the results generalise to real student programs or to full C: the benchmark consists of synthetic mutations of 30 programs.
- That the margin is a probability. No calibration to probabilities was attempted; calibration error is therefore not reported.
- That IntelliFix is better than CPCT+ at what CPCT+ was designed for. CPCT+ aims to report all minimum-cost repairs and to reduce cascading errors, not to choose the intended repair. Our comparison measures one specific use (top-1 AST recovery) on one grammar.
