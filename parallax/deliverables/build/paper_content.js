// Content of IntelliFix_IEEE_Conference_Paper.docx (IEEE conference style).
// Numbers come from `D` (stored evaluation results and a live compiler run).
"use strict";
module.exports = function paperContent(D) {
  const { T, S, pct, ci, pts, fig, cpRange, prof, run } = D;
  const pt = S.paired_tests, tau = S.tau_selection.tau;

  const abstract = `Compilers report syntax errors where the parser detects them, which often differs from where the mistake was made, and repair suggestions usually commit to one candidate even when several are equally plausible. We present IntelliFix, a syntax error analysis, detection and correction pipeline for MiniC, a teaching subset of C, built on a Flex lexer and a Bison LALR(1) parser with lookahead correction (LAC). IntelliFix generates bounded token edits guided by exact expected-token sets and by layout, validates every candidate with the real parser and a source round trip, ranks candidates with 13 interpretable evidence features, groups equivalent repairs by canonical abstract syntax tree, repairs later errors along hypothesis lanes, and recommends a repair only when its margin over the best structurally distinct alternative reaches a threshold chosen on development data. On 540 held-out synthetic error cases, its top-ranked repair restored the original syntax tree in ${pct(T.P.top1_ast)}% of cases, against ${pct(T.C.top1_ast)}% for least-cost repair over the same candidates and ${cpRange} for the first repair of CPCT+; abstention reduced wrong-but-confident recommendations from ${pct(T.F.false_confident_rate)}% to ${pct(T.P.false_confident_rate)}% of all cases at ${pct(T.P.coverage)}% coverage. Follow-on stability evidence showed no measurable gain. We report these results for synthetic mutations only.`;

  const indexTerms = "Syntax error repair, LR parsing, error recovery, abstention, selective prediction, compiler construction";

  const body = [
    { h1: "I. Introduction" },
    `LR parsers stop at the first token that cannot extend any valid program (the correct-prefix property). Detection is therefore early, but localisation is not: a missing semicolon is reported at the first token of the next line. Correction is underdetermined as well. For \`int total = 0\` followed by \`int i = 1;\`, both inserting ';' at the end of the first line and replacing the second \`int\` by ',' yield valid programs at nearly the same cost. A tool that silently picks one can be confidently wrong.`,
    `IntelliFix addresses localisation and correction together, and adds an explicit decision about confidence. Our contributions are:`,
    { bullets: [
      "an integrated, inspectable repair pipeline on top of LAC-guided local LR repair, adding layout-aware candidates, interpretable evidence ranking, AST-level grouping, multi-error hypothesis lanes and abstention with seven explicit outcomes;",
      "two-level validation (token parse and source round trip), so that every “valid” claim is a real parse of the text the user would see;",
      "an evaluation on a family-split synthetic benchmark with ablations, a real CPCT+ baseline and confidence intervals, including negative results.",
    ] },
    `We do not claim a new parsing or repair algorithm; each ingredient is established. The contribution is their combination and its measurement.`,

    { h1: "II. Related Work" },
    `Panic-mode recovery skips input to a synchronising token and resumes [1], [6]; it finds later errors but produces spurious ones and proposes no correction. Aho and Peterson's minimum-distance parser finds a valid string at minimum edit distance [2]. Burke and Fisher [3] and Corchuelo et al. [4] repair LR input locally with bounded edits accepted when parsing can continue; IntelliFix inherits this idea and its progress criterion. CPCT+ by Diekmann and Tratt computes the complete set of minimum-cost repair sequences at each error and is implemented in grmtools [5], [15]; it aims at recovery and chooses arbitrarily among equal-cost sequences when one must be applied. Bison's LAC makes expected-token sets exact despite default reductions [6]; Pottier studied error diagnosis in LR(1) automata [7]. DeepFix [8] and Seq2Parse [9] learn repairs from large corpora of real errors. Selective classification [10], [11] motivates our abstention policy and risk–coverage evaluation.`,

    { h1: "III. System Overview" },
    { h2: "A. MiniC and the Front End" },
    `MiniC supports four scalar types, functions, one-dimensional arrays, \`if\`, \`while\`, \`for\`, \`return\`, \`break\`, \`continue\` and arithmetic, comparison and logical operators; assignment is a statement. C constructs that MiniC omits (\`++\`, compound assignment, \`switch\`, strings, the preprocessor) are lexed as UNSUPPORTED tokens with explanations. The re-entrant Flex lexer [13] reports lexical errors as tokens with exact spans. The pure Bison parser has 97 rules and 168 states, \`%expect 0\`, custom error messages, LAC and panic-mode rules.`,
    { fig: fig("fig_pipeline"), width: 1, caption: "The IntelliFix pipeline; every stage is executed by the native compiler." },
    { h2: "B. Architecture" },
    `A C++17 binary reads source text and writes JSON. A FastAPI backend runs it in a worker thread per request with size, time and concurrency limits, and a React workbench displays every stage. No result is simulated: if the binary is missing, the interface shows an error with build instructions.`,

    { h1: "IV. Repair Method" },
    { h2: "A. Candidates and Validation" },
    `At the first error index e, the window generator proposes every insertion and replacement allowed by the exact LAC expected set, and every deletion, at positions e−3 to e (costs 1, 1 and 1.5). Layout generators propose ';' at line ends, braces at indentation changes and the deletion of doubled delimiters. Two-edit candidates are tried only if no single edit is accepted. A candidate is accepted if the program parses or the parser advances at least three tokens past the edit; accepted candidates are rebuilt as text with the user's whitespace and comments, re-lexed and re-parsed. For the missing-semicolon example, ${run.generated} candidates were generated and ${run.accepted} accepted.`,
    { h2: "B. Evidence Ranking" },
    `Each candidate scores Σ vᵢwᵢ over 13 named features: edit cost, complete parse, placeholders, deleted user content, distance from the error, line-end ';', indentation-consistent braces, duplicate deletion, indentation mismatch and name-resolution warnings in the repaired AST, residual diagnostics, cascades and the cost of completing later repairs. Weights were set on the development split and frozen. Table I shows the live evidence for the example.`,
    { table: { caption: "Evidence for the three valid candidates of the missing-semicolon example", widths: [0.37, 0.21, 0.21, 0.21], align: [null, "r", "r", "r"],
      head: ["Feature", ...run.cands.map((c) => c.name)], rows: run.evidenceRows } },
    { h2: "C. Grouping, Lanes and Decision" },
    `Candidates with identical canonical ASTs form one class, so \`(a) + 2\` and \`(a + 2)\` do not compete. For the top three first-error classes, hypothesis lanes repair later errors (two alternatives per step, depth ≤ 4, ≤ 12 leaves). The margin is the score difference between the best and second-best class. The status is UNSUPPORTED_CONSTRUCT for an unsupported first error or a parser stack overflow; NO_SAFE_REPAIR or BUDGET_EXHAUSTED without candidates; LOW_CONFIDENCE for incomplete plans, placeholders or discarded multi-line lexical errors; MULTIPLE_PLAUSIBLE if the margin is below τ = ${tau}; otherwise RECOMMENDED. τ maximises development coverage subject to development selective risk ≤ 10%.`,

    { h1: "V. Evaluation" },
    { h2: "A. Setup" },
    `Thirty valid programs were mutated with a fixed seed into ${S.n_cases} cases (720 single-error, 180 two-error). Splitting by program gives 360 development cases (12 programs) and 540 test cases (18 programs), preventing near-duplicate leakage. Systems: raw parser (A), panic mode (B), least-cost repair over the same candidates (C), IntelliFix without grouping (D), stability evidence (E), abstention (F) or layout evidence (L), full IntelliFix (P), and CPCT+ via grmtools nimbleparse 0.15.0 (G, two replicates). The primary metric is top-1 AST match against the original program. Proportions use Wilson intervals [12]; differences use a paired bootstrap with 2000 resamples [14].`,
    { h2: "B. Results" },
    { table: { caption: "Test-split results (n = 540)", widths: [0.3, 0.18, 0.17, 0.17, 0.18], align: [null, "r", "r", "r", "r"],
      head: ["System", "Top-1", "Cov.", "Sel. acc.", "Wrong-conf."], rows: D.paperRows } },
    `Evidence ranking improved top-1 over least-cost repair by +${pts(pt.top1_ast_P_minus_C.diff)} points (CI [${pts(pt.top1_ast_P_minus_C.ci95[0])}, ${pts(pt.top1_ast_P_minus_C.ci95[1])}]) and layout evidence contributed +${pts(pt.top1_ast_P_minus_L.diff)} points (CI [${pts(pt.top1_ast_P_minus_L.ci95[0])}, ${pts(pt.top1_ast_P_minus_L.ci95[1])}]). Stability evidence changed top-1 by +${pts(pt.top1_ast_P_minus_E.diff)} points (CI [${pts(pt.top1_ast_P_minus_E.ci95[0])}, ${pts(pt.top1_ast_P_minus_E.ci95[1])}]): no measurable benefit. Grouping raised coverage from ${pct(T.D.coverage)}% to ${pct(T.P.coverage)}% at an unchanged wrong-but-confident rate. Abstention lowered wrong-but-confident recommendations by ${pts(-pt.false_confident_P_minus_F.diff)} points; selective accuracy was ${pct(T.P.selective_accuracy)}%, so the selective risk (${(100 - +pct(T.P.selective_accuracy)).toFixed(1)}%) missed the 10% development target. AURC was ${T.P.aurc.toFixed(3)} for IntelliFix and ${T.C.aurc.toFixed(3)} for least-cost repair. The first edit was at the mutated token in ${pct(T.P.localisation_exact)}% of cases, against ${pct(T.A.localisation_exact)}% for the raw parser's detection point. CPCT+'s first repair reached ${cpRange} over three runs; it was designed for recovery, not for choosing one intended repair, so this does not show that IntelliFix is a better recovery algorithm.`,
    { fig: fig("fig_top1"), width: 1, caption: "Top-1 AST match on the test split with 95% Wilson intervals." },
    { fig: fig("fig_risk_coverage"), width: 1, caption: "Risk–coverage curves on the test split." },

    { h1: "VI. Robustness Testing" },
    `Besides ${D.tests.total} unit, API, evaluation and interface tests, a professor-style suite of ${prof.hand_total} hand-written cases with expectations stated before execution, ${prof.fuzz_inputs} seeded fuzz inputs checked against invariants (no crash, exact token spans, every parser-valid candidate re-parses) and ${prof.http_total} HTTP sequences all passed after two defects were fixed: a valid but deeply nested program was searched for 3.5 s and given non-parsing brace deletions, and an unterminated comment was replaced, discarding the code inside it. Two confident but unintended repairs (\`whlie (i < 3) {\` receiving ';', and a deleted \`while\`) were left unchanged to avoid tuning on observed cases.`,

    { h1: "VII. Limitations" },
    `The errors are synthetic single-token mutations of 30 programs by one author, whose consistent indentation favours layout evidence; no claim is made about real student code. Weights are hand-set and the margin is not a calibrated probability. MiniC is a subset of C and IntelliFix checks syntax only, so a parser-valid repair can change meaning. The Windows build was tested only under Wine.`,

    { h1: "VIII. Conclusion" },
    `Combining exact LAC expectations, layout and name evidence, structural grouping and abstention makes local LR repair both more accurate and more honest on our benchmark. Future work includes a study with real student errors, learned and calibrated weights, and type-aware evidence.`,
  ];

  const references = [
    "A. V. Aho, M. S. Lam, R. Sethi, and J. D. Ullman, *Compilers: Principles, Techniques, and Tools*, 2nd ed. Boston, MA, USA: Addison-Wesley, 2006.",
    "A. V. Aho and T. G. Peterson, “A minimum distance error-correcting parser for context-free languages,” *SIAM J. Comput.*, vol. 1, no. 4, pp. 305–312, 1972.",
    "M. G. Burke and G. A. Fisher, “A practical method for LR and LL syntactic error diagnosis and recovery,” *ACM Trans. Program. Lang. Syst.*, vol. 9, no. 2, pp. 164–197, 1987.",
    "R. Corchuelo, J. A. Pérez, A. Ruiz-Cortés, and M. Toro, “Repairing syntax errors in LR parsers,” *ACM Trans. Program. Lang. Syst.*, vol. 24, no. 6, pp. 698–710, 2002.",
    "L. Diekmann and L. Tratt, “Don't panic! Better, fewer, syntax errors for LR parsers,” in *Proc. ECOOP 2020*, LIPIcs, vol. 166, pp. 6:1–6:32, doi: 10.4230/LIPIcs.ECOOP.2020.6.",
    "Free Software Foundation, “LAC,” *GNU Bison Manual*. [Online]. Available: https://www.gnu.org/software/bison/manual/html_node/LAC.html",
    "F. Pottier, “Reachability and error diagnosis in LR(1) automata,” in *Proc. JFLA*, 2016.",
    "R. Gupta, S. Pal, A. Kanade, and S. Shevade, “DeepFix: Fixing common C language errors by deep learning,” in *Proc. AAAI*, 2017, doi: 10.1609/aaai.v31i1.10742.",
    "G. Sakkas *et al.*, “Seq2Parse: Neurosymbolic parse error repair,” *Proc. ACM Program. Lang.*, vol. 6, no. OOPSLA2, 2022, doi: 10.1145/3563330.",
    "R. El-Yaniv and Y. Wiener, “On the foundations of noise-free selective classification,” *J. Mach. Learn. Res.*, vol. 11, pp. 1605–1641, 2010.",
    "Y. Geifman and R. El-Yaniv, “Selective classification for deep neural networks,” in *Proc. NeurIPS*, 2017.",
    "E. B. Wilson, “Probable inference, the law of succession, and statistical inference,” *J. Amer. Statist. Assoc.*, vol. 22, no. 158, pp. 209–212, 1927.",
    "The Flex Project, “flex: The fast lexical analyzer.” [Online]. Available: https://github.com/westes/flex",
    "B. Efron and R. J. Tibshirani, *An Introduction to the Bootstrap*. New York, NY, USA: Chapman & Hall, 1993.",
    "softdevteam, “grmtools,” GitHub repository. [Online]. Available: https://github.com/softdevteam/grmtools",
  ];
  return { abstract, indexTerms, body, references };
};
