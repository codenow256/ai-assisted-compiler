# IntelliFix — research contribution and novelty

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


Related work and full references: [RESEARCH_POSITIONING.md](RESEARCH_POSITIONING.md). Numbers: [IntelliFix_Evaluation_and_Reproducibility.md](IntelliFix_Evaluation_and_Reproducibility.md).

## 1. The defensible novelty statement

> IntelliFix does not introduce a new parsing or repair algorithm. Its contribution is an **integrated, inspectable syntax-repair pipeline** for an LR-parsed C-like language. The pipeline combines local LR repair (Burke–Fisher style), driven by exact LAC expected sets, with four additions evaluated together: **layout-aware candidate generation**, an **interpretable evidence ranking** checked by a source round trip, **AST-level grouping of equivalent repairs**, and **confidence-aware abstention**, with seven explicit outcomes and a threshold chosen on held-out development data. The second contribution is an **honest evaluation**: a family-split benchmark with ablations, a real CPCT+ baseline, and confidence intervals, reporting which parts help (evidence ranking, layout, abstention) and which do not (follow-on stability evidence).

Say “integrated”, “evaluated” and “inspectable”. Do not say “first”, “novel algorithm”, “state of the art”, or “better than CPCT+”.

## 2. Contribution-to-evidence table

| # | Claimed contribution | Kind | Evidence (where to look) | Strength |
|---|---|---|---|---|
| C1 | Multi-candidate local repair guided by **exact** LAC expected sets, with each candidate validated by a real parse | engineering, integration of known ideas | REPAIR_ALGORITHM.md §3–4; fuzzing: 0 of 800 inputs had a "parser-valid" candidate that failed to re-parse | implemented and tested; not new in itself |
| C2 | **Layout-aware generators and features** (line-end `;`, braces at indentation changes, doubled delimiters) | design + empirical | ablation L: top-1 −8.9 points without them, paired CI [6.7, 11.3] | **supported** on this benchmark; caveat: one author's consistent indentation flatters it |
| C3 | **Interpretable evidence ranking** (13 named features, weights frozen on dev) instead of cost only | design + empirical | P vs C: +16.3 points top-1, CI [13.1, 19.4]; per-feature contributions in the UI | **supported** (same candidate space, so the gain is from ranking) |
| C4 | **Two-level validation** (token parse plus source round trip) | engineering | catalog and fuzzing invariants; the `malformed` outcome | implemented; prevents a class of display bugs, not an accuracy claim |
| C5 | **AST equivalence classes** for measuring confidence | design + empirical | ablation D: coverage 50.7% vs 48.9% at an equal 6.1% wrong-confident rate; AURC 0.139 vs 0.143 | **weak**: small effect |
| C6 | **Hypothesis lanes** for multiple errors, with a stability report | design + empirical | ablation E (no follow-on evidence): +0.2 points, CI [−0.4, 0.9] | **not supported** as an accuracy gain; kept for explanation (Hypothesis explorer) |
| C7 | **Confidence-aware abstention** with seven explicit statuses and τ chosen on dev | design + empirical | wrong-but-confident 6.1% vs 28.5% forced (−22.4, CI [−25.9, −18.9]) at 50.7% coverage | **supported**, with a caveat: test selective risk 12.0% missed the 10% dev target |
| C8 | Honest handling of **non-MiniC input** (unsupported C constructs, nesting limit) | engineering | catalog L16, S35; professor cases P18, P64–P71, P86 | implemented |
| C9 | **Reproducible evaluation**: family split, seeds, ablations, CPCT+ baseline, Wilson and bootstrap intervals; an audit that found and fixed a harness bug | methodology | Evaluation & Reproducibility §1–4 | done; synthetic errors only |
| C10 | **Inspectable workbench**: every stage on real compiler output; no simulated results | engineering, teaching | screenshots in IntelliFix_Visual_Walkthrough.md; 26 UI unit tests and E2E | implemented |

## 3. What is inherited (say this plainly)

| Idea | From |
|---|---|
| Local repair near the error with a progress criterion | Burke & Fisher, TOPLAS 1987; Corchuelo et al., TOPLAS 2002 |
| Edit-distance repair (insert, delete, replace with costs) | Aho & Peterson, SIAM J. Comput. 1972 |
| Exact expected tokens in LR parsers | Bison LAC (Denny) |
| Panic-mode recovery | standard technique; Bison `error` token |
| Complete set of minimum-cost repairs | Diekmann & Tratt, ECOOP 2020 (CPCT+, our baseline G) |
| Selective prediction, risk–coverage, AURC | El-Yaniv & Wiener, JMLR 2010; Geifman & El-Yaniv, NeurIPS 2017 |
| Learned repair (contrast) | DeepFix (AAAI 2017), Seq2Parse (OOPSLA 2022) |

## 4. How IntelliFix differs from CPCT+ (for the inevitable question)

| | CPCT+ | IntelliFix |
|---|---|---|
| Goal | report **all** minimum-cost repair sequences; reduce cascading errors | pick the repair most likely to be **intended**, or say it cannot |
| Ranking | cost only; ties broken arbitrarily | 13 evidence features, then AST classes, then a margin |
| Uses layout or names | no | yes |
| Abstains | no | yes, with seven statuses |
| Search | complete within its cost bound | bounded (window of 3 tokens, at most 2 edits per site, 12 leaves) |
| Our measurement | top-1 AST match 47.4–49.1% over three runs (its replicates agree on 68.6–70.1% of cases) | 71.5% |

Correct reading: on this benchmark and for this use (choose one intended repair), evidence ranking helps. It does **not** show that IntelliFix is a better recovery algorithm. CPCT+ was not designed to choose one repair, and we did not measure what it optimises.

## 5. Claims to avoid, and what to say instead

| Do not say | Say |
|---|---|
| “IntelliFix fixes syntax errors automatically.” | “It proposes parser-validated repairs and recommends one only when the evidence clearly favours it, about half of the time on our test set.” |
| “71.5% accuracy on student code.” | “71.5% top-1 AST match on 540 synthetic mutations of 30 programs.” |
| “It always finds the right fix.” / “Validated means correct.” | “Validated means the parser accepts it. Intent is not guaranteed. For example, `whlie (…) {` gets a confident, wrong fix.” |
| “Better than CPCT+.” | “Higher top-1 AST recovery than CPCT+'s first repair on our benchmark; CPCT+ optimises something else.” |
| “The margin is the probability that the fix is right.” | “The margin is a score difference; no calibration is claimed.” |
| “Stability analysis improves accuracy.” | “It did not measurably improve accuracy (+0.2, CI includes 0); it helps explanation.” |
| “Novel algorithm.” / “First system to…” | “An integrated and evaluated combination of known techniques.” |
| “AI-powered.” | “A rule- and evidence-based system; no machine learning model is trained.” |
| “Works on Windows.” | “Cross-compiled for Windows and tested under Wine; not yet run on a real Windows machine.” |

## 6. Questions an examiner may use to probe novelty

1. *What is new here?* → §1, then C2, C3 and C7 with their numbers.
2. *Isn't this just Burke–Fisher plus heuristics?* → Yes for generation. The heuristics are named, frozen before testing and ablated, and each one's effect is measured, including the ones with no effect.
3. *Why not machine learning?* → No real error corpus was available. The weights are interpretable and hand-set on dev. A learned ranker is future work and would need real data.
4. *Would it work for full C?* → The pipeline depends only on an LR grammar with LAC, but full C adds typedef-name ambiguity, the preprocessor and a much larger grammar. Not tested.
5. *How do you know you did not tune on the test set?* → Family split, the freeze commit `03331c0` and an audit `git diff`. The two later decision rules leave all 900 benchmark results unchanged. The known pre-freeze smoke-run contact is disclosed.
