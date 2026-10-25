# IntelliFix — interactive and explanation features

> **Interface note (v2, 25 Oct 2026):** page names in this document (Code workbench, Repair laboratory, Guided demo, …) refer to the earlier ten-page interface. The app now has three destinations — Workspace, AST Explorer, Research & Method; [`IntelliFix_UX_v2.md`](IntelliFix_UX_v2.md) §4 says where each earlier page now lives.


These features are implemented in the web interface on top of the existing compiler and repair engine; **the compiler and the repair engine were not changed for them**, so the stored evaluation still describes the system exactly. Every sentence and option they show is derived from real compiler output (tokens, diagnostics with exact LAC expected sets, AST, candidates, plans, stability entries, decision).

| Feature | Where | Grounded in | Tests |
|---|---|---|---|
| Plain-language explanation for every result | Workbench → right column, “What IntelliFix found” | `frontend/src/lib/explain.ts` over the repair (or parse) response | 102 cases in `tests/unit/explain.test.ts` (all 88 professor-style inputs + extras, real responses) |
| A. Interactive ambiguity resolution | Workbench → “IntelliFix needs your help” | the decision's real top plans; placeholder edits become a fill-in box; suggestions are names declared earlier (lexer tokens) | unit + E2E “ambiguity: the user fills in…” |
| B. Explainable repair comparison | Workbench → “Compare the N structurally different repairs”; Repair laboratory → Compare | plans/candidates: edits, edit cost, parser validity, margin and τ; full per-feature evidence in the Repair lab | unit, E2E |
| C. Before-and-after AST | AST explorer → “Before & after” | `/api/repair/compare` (both programs re-parsed by the compiler); nodes marked only by exact kind + span match | E2E “AST compare”, “invalid code: … partial tree” |
| D. Error cascade / likely root cause | Workbench → “Several errors reported — which one to fix first?” | number of panic-mode diagnostics; whether one edit of the top plan makes the whole program parse; stability entries (“stable across tested hypotheses”) | unit “cascades are explained with evidence” |
| E. Student-guided repair, progressive hints | Workbench → “Want to fix it yourself?” | hint 1: location; hint 2: expected tokens in words; hint 3: real plans; “Check my fix” re-runs the real compiler and compares the first-error line | E2E “student practice” |
| F. Research and reliability dashboard | Evaluation & impact (existing) | `evaluation/results/summary.json` | E2E “evaluation page” |
| Detailed AST explorer | AST explorer → “Explained tree” | real AST (valid code), labelled partial tree from error recovery (invalid code), labelled AST of the top-ranked repair | E2E “AST explorer: a selected node is explained…”, unit (every node kind has an explanation) |

## What the explanation says for each kind of input

| Input | Explanation (abridged, real behaviour) |
|---|---|
| valid program | “Your program is valid MiniC”; a summary of functions, variables, loops, calls and operators from the AST; **explicitly not a claim of semantic correctness** |
| empty / comments only | “The editor is empty: an empty program is valid MiniC, but it does nothing.” |
| missing `;` | the line where the parser stopped, what was found, what MiniC allows there (in words), and “that pattern often means the previous line is missing its `;`” |
| cause earlier than detection | “the parser noticed the problem on line 8, but the top-ranked fix changes line 4” (from the plan's first edit) |
| several errors | which report to trust first; whether one edit fixes everything (later reports were cascades) or several edits are needed (independent mistakes); stable sites as “likely, not proven” |
| `int total = price + ;` | missing expression after `+`; asks: delete `+`, replace `+` with `;`, or type the expression (suggests `price`, not `total`, which is still being declared); the answer is checked by the parser before it can be applied |
| missing name `int = 4;` | low confidence; a name fill-in; never invents the name |
| `a b` | 20 operators tie (margin 0.00); asks which one |
| C constructs (`i++`, `#include`, `switch`) | “This is C, not MiniC” with the lexer's advice; hints point to rewriting |
| invalid characters, malformed numbers, smart quotes | lists the lexical errors with positions |
| unterminated `/*` | explains it; **does not offer** the candidate that would delete the code hidden in the comment |
| very deep nesting | capacity limit of the parser stack, not necessarily a mistake |
| statements outside a function | “statements must be inside a function body” |
| no safe repair | says that no small edit works and what to try instead |

## Offline bound for interactive clarification (simulation, not a user study)

`python3 -m evaluation.experiments.clarification_bound` → `evaluation/results/clarification_bound.json`.

On the held-out test split, IntelliFix abstains (multiple plausible or low confidence at τ = 1.5) on **256 of 540** cases. The clarification card shows the decision's top plans (up to three structurally distinct repairs), so for each abstained case we can check, from stored results, whether the original program is among the options:

| Simulated user | Correct repair obtained | Note |
|---|---|---|
| always picks the first option | 136 / 256 (53.1%) | equals top-1 AST match on this subset |
| recognises the correct option if it is shown | 153 / 256 (59.8%) | equals top-3 AST match on this subset; an **upper bound** for option choice |
| by ambiguity type (oracle): structural | 107 / 122 | |
| operator choice | 20 / 50 | |
| content lost (deleted name or value) | 26 / 84 | the intended content is gone; only a user-typed fill-in can restore it, which this simulation does not model |

What this shows: offering the alternatives (instead of a single recommendation) puts the correct repair within reach in at most 59.8% of abstained cases, and the gap is largest where the program's content was deleted. It says nothing about whether real students choose correctly, how long they take, or whether they learn more — that needs the study below.

## Proposed user study (not run)

1. **Subset.** The 256 abstained test cases above, stratified by ambiguity type (structural, operator choice, content lost); sample 30 cases per type.
2. **Conditions (within subjects, counterbalanced).** (a) existing pipeline: top-ranked repair shown with its status; (b) clarification card + hints + before/after AST.
3. **Participants.** Students of an introductory C course, with consent; no grading consequences.
4. **Measures.** Share of cases ending in the original program (AST match); time to resolution; number of re-analyses; wrong accepts (a parser-valid but non-original program accepted); a short comprehension question per case (“why was this the error?”).
5. **Analysis.** Paired comparison per participant with bootstrap intervals; report by ambiguity type; pre-register the hypotheses and stopping rule.
6. **Threats.** Synthetic cases, learning effects across conditions, small sample.

No result of this study exists yet; no usability or learning benefit is claimed.
