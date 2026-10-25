# IntelliFix — glossary

Terms in alphabetical order. *(In IntelliFix: …)* says how the project uses the term.

| Term | Meaning |
|---|---|
| **Abstention** | Declining to give a confident answer. *(In IntelliFix: any status other than Recommended when the program is invalid.)* |
| **Ablation** | An experiment that switches off one component to measure what it contributes. *(Systems D, E, F, L.)* |
| **Accepted candidate** | A candidate edit after which the program parses completely, or the parser gets at least 3 tokens further. |
| **AST** | Abstract syntax tree: program structure without punctuation such as parentheses, braces and semicolons. |
| **AST equivalence class** | All candidates whose repaired programs have the same canonical AST. They count as one alternative. |
| **AURC** | Area under the risk–coverage curve: the mean error rate as you accept more and more answers, ordered by confidence. Lower is better. |
| **Bison** | GNU parser generator. It turns a grammar (`minic.y`) into an LALR(1) parser in C/C++. |
| **Bootstrap (paired)** | Resampling cases with replacement (2000 times, seed 7) to get a confidence interval for the difference between two systems on the *same* cases. |
| **Budget** | The search limit: 30,000 parser invocations or 4 s per request. |
| **Canonical form** | A string written from the AST: node kinds, attributes and children, without positions, whitespace or comments (parentheses are not AST nodes anyway). Equal strings mean structurally identical programs. Its FNV-1a hash is the displayed AST hash; grouping compares the full strings. |
| **Candidate** | One proposed edit (or a pair of edits) to the token stream. |
| **Cascade (error)** | A follow-on error caused by the first error, or by recovery from it, rather than by a separate mistake. |
| **Correct-prefix property** | An LR parser stops at the first token that cannot continue any valid program. |
| **Coverage** | The share of all cases that receive a *Recommended* repair. |
| **CPCT+** | The repair algorithm of Diekmann & Tratt (ECOOP 2020): it finds all minimum-cost repair sequences. It is baseline G, run with grmtools `nimbleparse`. |
| **Detection point** | Where the parser notices the error. It is often later than the mistake. |
| **Dev split** | The 360 cases (12 programs) used for all tuning. |
| **Edit** | Insert, delete or replace one token. Cost 1, 1 and 1.5. |
| **Evidence (feature)** | One named, measurable property of a candidate, such as `line_end_semicolon`. 13 in total. |
| **Expected set** | The token kinds the parser could accept at a position. Made exact by LAC. |
| **Family** | All benchmark cases derived from one source program. The split is by family. |
| **Flex** | A fast lexer generator. It turns regular expressions (`minic.l`) into a C scanner. |
| **Grammar** | The rules that define valid token sequences. MiniC has 97 rules. |
| **Hypothesis lane** | A search path: one first-error fix, then fixes for the errors that follow it. |
| **LAC** | Lookahead correction (Bison). It checks the lookahead before default reductions, so the expected-token list is exact. |
| **LALR(1)** | Look-Ahead LR with 1 token of lookahead: the parser class Bison generates by default. Compact tables, slightly weaker than canonical LR(1). |
| **Layout evidence** | Evidence from line breaks and indentation: a `;` at a line end, braces at indentation changes. |
| **Lexeme** | The exact text of a token, e.g. `total`. |
| **Lexer** | Turns characters into tokens (lexical analysis). |
| **Localisation** | Finding *where* the mistake is. Measured as the first edit's position against the injected mutation. |
| **LR state** | A parser state: a set of partially matched grammar rules (items). MiniC's automaton has 168. |
| **Margin** | Score of the best AST class minus the score of the second-best class. Compared with τ. |
| **MiniC** | The C-like teaching language that IntelliFix compiles (see MINIC_LANGUAGE_SPEC.md). |
| **Mutation** | A synthetic error injected into a valid program, e.g. deleting a `;`. |
| **Panic mode** | Recovery by skipping tokens until a synchronising token such as `;` or `}`. |
| **Parser** | Checks token order against the grammar and builds the tree (syntax analysis). |
| **Placeholder** | An invented token for something that cannot be known: `__hole` for a name, `0` for a number. It lowers confidence. |
| **Plan** | A complete sequence of edits, one or more steps, from the best lane. |
| **Round trip** | Turning an edited token stream back into source text, re-lexing it and re-parsing it, to make sure the text says what the tokens say. |
| **Selective accuracy / risk** | Correct (or wrong) recommendations divided by the number of recommendations. |
| **Shift / reduce** | LR parser actions: consume the next token, or replace the right-hand side of a rule with its left-hand side. |
| **Stability** | Whether a later error appears under every explored first-fix hypothesis (stable) or only some (hypothesis-dependent). |
| **Status** | The decision: No repair needed, Recommended, Multiple plausible, Low confidence, No safe repair, Budget exhausted, Unsupported construct. |
| **τ (tau)** | The minimum margin required to recommend. 1.5, chosen on the dev split. |
| **Test split** | The 540 held-out cases (18 programs), used only for final measurement. |
| **Token** | The smallest meaningful unit of source code, with a kind, a lexeme and a span. |
| **Top-1 AST match** | The first plan's program has the same canonical AST as the original. This is the main metric. |
| **Trivia** | Comments and whitespace: kept for reconstruction, but not tokens. |
| **Unsupported token** | A C construct that MiniC recognises but does not allow (`++`, `+=`, `switch`, strings, …). |
| **Wilson interval** | A confidence interval for a proportion that behaves well near 0% and 100%. |
| **Wrong-but-confident rate** | Wrong recommendations divided by *all* cases. |
