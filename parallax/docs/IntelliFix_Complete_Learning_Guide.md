# IntelliFix — complete learning guide

**IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction**
Team: Goutam Jayasingh (24BCE2417) · S Charumeena (24BCI0238) · Raguraman Govindasamy (24BDS0409)

This guide explains the whole project in plain language, from the basics up. For graded exercises, see [IntelliFix_From_Zero_to_Advanced_Guide.md](IntelliFix_From_Zero_to_Advanced_Guide.md). For terms, see [IntelliFix_Glossary.md](IntelliFix_Glossary.md).

---

## Part A — explain it in one, three or five minutes

### One minute

> When you forget a semicolon, the compiler usually complains about the **next** line, because that is where it notices something is wrong. IntelliFix is a compiler front end for a small C-like language, MiniC, that does three things. It **detects** syntax errors with a real Flex lexer and Bison parser. It **analyses** many possible fixes, checking each one by actually parsing the result. And it **decides** honestly: if one fix is clearly best it recommends it; if several fixes are equally plausible, or the fix would have to invent a missing name, it says so instead of guessing. On 540 held-out test cases, its top-ranked fix restored the original program 71.5% of the time, against 55.2% for a cheapest-edit baseline. Only 6.1% of cases got a wrong fix presented as confident.

### Three minutes

Add these points to the one-minute version:

1. **Why the cheapest fix is not enough.** Many edits make a broken program parse. For `int total = 0` followed by `int i = 1;`, both “insert `;` at the end of line 3” and “replace `int` on line 4 with `,`” give valid programs. Both cost about one edit. A programmer almost certainly meant the first.
2. **How IntelliFix chooses.** Every candidate is scored by 13 named pieces of evidence: edit cost, whether the program parses completely, whether a `;` lands exactly at a line end, whether braces match the indentation, whether the repaired program uses undeclared names, and so on. All weights were fixed on a development split and then frozen.
3. **Equivalent fixes do not compete.** Two edits that produce the same syntax tree (`(a) + 2` and `(a + 2)`) are grouped, so they do not make IntelliFix falsely “unsure”.
4. **Several errors.** IntelliFix follows the top few first-error hypotheses and repairs later errors under each, so a plan can fix two or three mistakes.
5. **Honesty.** There are seven statuses: no repair needed, recommended, multiple plausible, low confidence, no safe repair, budget exhausted, unsupported construct. IntelliFix recommends only when the best structural alternative leads by a margin τ = 1.5. It recommended a repair in about half the test cases, and 88% of those recommendations were correct.

### Five minutes

Add these points to the three-minute version:

6. **Engineering.** C++17 core (Flex, Bison, repair engine), a FastAPI backend that runs the real compiler binary for every request, and a React workbench that shows each stage with real data. No result is simulated. If the compiler is missing, the UI says “Compiler not built”.
7. **Evaluation.** 30 hand-written programs; 900 seeded mutations (single and double errors). The split is by program, so that no near-duplicate leaks between development and test. Baselines: raw parser, panic mode, least-cost repair, CPCT+ (a published state-of-the-art recovery algorithm from Diekmann & Tratt, ECOOP 2020), and ablations that switch off one idea at a time.
8. **What worked and what didn't.** Evidence ranking +16.3 points over least-cost (CI 13.1–19.4); layout evidence +8.9. Abstention cut wrong-but-confident answers from 28.5% to 6.1%. The follow-on stability evidence gave no measurable gain (+0.2, CI includes 0). Selective risk on test was 12%, above the 10% target.
9. **Limits.** Errors are synthetic, not real student code. MiniC is a subset of C. A valid fix can still change meaning: `whlie (i < 3) {` gets “insert `;`”, which turns it into a call to `whlie`. We report that rather than tune it away.
10. **Contribution.** No single technique is new. The contribution is a combined, inspectable and tested pipeline that adds evidence ranking, structural grouping, multi-error lanes and abstention to local LR repair, plus an honest evaluation of which parts help.

---

## Part B — the concepts, in order

### B1. What a compiler front end does

```
source text ──▶ LEXER ──▶ tokens ──▶ PARSER ──▶ syntax tree (AST) ──▶ (semantic analysis, code generation: not in IntelliFix)
```

- **Lexer** (lexical analysis): cuts text into **tokens**, such as `int`, `total`, `=`, `0`. It knows spelling, not grammar. IntelliFix uses **Flex**.
- **Parser** (syntax analysis): checks that the tokens follow the **grammar** and builds a tree. IntelliFix uses **Bison**, which generates an **LALR(1)** parser.
- **AST** (abstract syntax tree): the program's structure without punctuation. `(a + b) * c` becomes `Binary(*, Binary(+, a, b), c)`.

### B2. MiniC

MiniC is a teaching subset of C: `int float char bool void`, functions, arrays, `if/else`, `while`, `for`, `return`, `break`, `continue`, and the usual operators. Assignment is a *statement*, so `x = y = 1` is an error. C features it omits (`++`, `+=`, strings, `switch`, pointers, …) are **recognised and labelled “unsupported”**, so IntelliFix can say “this is C, not MiniC” instead of inventing a repair. Specification: [MINIC_LANGUAGE_SPEC.md](MINIC_LANGUAGE_SPEC.md).

### B3. How an LR parser finds an error

An LR parser reads tokens left to right. It keeps a **stack of states**, and each state summarises what it has read so far. For each state and next token, the table says **shift** (consume the token), **reduce** (apply a grammar rule), **accept**, or **error**. LR parsers have the **correct-prefix property**: they stop at the first token that cannot continue *any* valid program. That is where an error is **detected**. It is not always where it was **made**: the missing `;` is at the end of line 3, but the parser stops at `int` on line 4.

**LAC (lookahead correction)** is a Bison feature that makes the parser's list of “expected tokens” exact. IntelliFix uses that list to generate only edits that make sense to the grammar.

### B4. Panic-mode recovery

Classic recovery: skip tokens until a “synchronising” token such as `;` or `}`, then continue. It finds more errors, but it often reports **spurious** ones caused by the recovery itself. In our test split, panic mode reported 3.85 diagnostics per case on average, and 61% of cases had at least one spurious diagnostic. IntelliFix uses panic mode as a baseline and to count leftover errors after a candidate edit.

### B5. Candidate repairs

An **edit** inserts, deletes or replaces one token. IntelliFix tries:

- every edit allowed by LAC at the error token and the 3 tokens before it;
- **layout** edits further back: `;` at a line end, `{` or `}` where indentation changes, deleting a doubled delimiter;
- two-edit combinations, but only if no single edit works.

Each candidate is applied to a copy of the tokens and **parsed again**. It is kept only if the parser gets at least 3 tokens further than before, or the whole program parses.

### B6. Two-level validation

A kept candidate is turned back into **text**, using the user's own spaces and comments. That text is lexed again, the tokens must match exactly, and it is parsed again. This catches edits that look fine as tokens but would print wrongly, such as two tokens gluing together.

### B7. Evidence and ranking

`score = Σ value × weight` over 13 features (table in [REPAIR_ALGORITHM.md §5](REPAIR_ALGORITHM.md)). Positive evidence: the program parses completely, a `;` exactly at a line end, a brace that matches the indentation. Negative evidence: cost, invented names (`__hole`), deleting the user's names or keywords, undeclared names afterwards, leftover errors. The score is for **ranking only**; it is not a probability.

### B8. AST equivalence classes

Candidates that produce the same canonical AST are one **class**. Confidence is the gap between the best class and the second-best class, not between two candidates that mean the same thing.

### B9. Hypothesis lanes (several errors)

For the top 3 first-error classes, IntelliFix repairs the next error, then the next (2 alternatives per step, up to depth 4, at most 12 leaves). A **plan** is the best complete path. The **stability** report shows which later errors appear whatever the first fix was.

### B10. The decision (abstention)

Checked in this order:

1. **No repair needed.** The program parses.
2. **Unsupported construct.** The error is a C feature MiniC omits, or nesting exceeds the parser's stack.
3. **No safe repair / Budget exhausted.** No candidate works.
4. **Low confidence.** The plan is incomplete, invents a name or value, or discards a multi-line lexical error.
5. **Multiple plausible.** The margin is below τ = 1.5.
6. **Recommended.** Otherwise.

**τ** was chosen on the development split as the setting with the most coverage at no more than 10% risk.

### B11. How we know it works

Read [IntelliFix_Evaluation_and_Reproducibility.md](IntelliFix_Evaluation_and_Reproducibility.md). Main metrics:

- **top-1 AST match:** the first plan gives the original program's tree;
- **coverage:** the share of cases that get a recommendation;
- **selective accuracy:** the share of recommendations that are correct;
- **wrong-but-confident rate:** wrong recommendations as a share of *all* cases.

---

## Part C — where each idea lives in the code

| Idea | File |
|---|---|
| tokens, lexical errors | `compiler/grammar/minic.l`, `compiler/src/token.cpp` |
| grammar, LAC, panic mode | `compiler/grammar/minic.y` |
| AST, canonical form | `compiler/src/ast.cpp`, `include/parallax/ast.hpp` |
| names and scopes | `compiler/src/names.cpp` |
| candidates, evidence, classes, lanes, decision | `compiler/src/repair_engine.cpp` |
| edits → text (round trip) | `compiler/src/repair_stream.cpp` |
| JSON output, CLI | `compiler/src/serialize.cpp`, `compiler/src/main.cpp` |
| API | `backend/app/main.py`, `backend/app/compiler.py` |
| UI | `frontend/src/features/*` |
| evaluation | `evaluation/` |

(Internal names still say `parallax`. That was the working title, and renaming the directories would break build paths. See the README's “Naming” note.)

## Part D — how to study this in a week

| Day | Read | Do |
|---|---|---|
| 1 | Part A, B1–B3, MINIC_LANGUAGE_SPEC | write 3 valid and 3 invalid MiniC programs; run the parser on them |
| 2 | B4–B6, LEXER_DESIGN, GRAMMAR_AND_PARSER | open Grammar & parsing; explain the LR state at an error |
| 3 | B7–B10, REPAIR_ALGORITHM | for the missing-semicolon example, explain each evidence row |
| 4 | End-to-End Trace | rebuild the trace on your own input |
| 5 | Evaluation & Reproducibility, RESULTS_AND_IMPACT | explain every headline number and its denominator |
| 6 | Viva Question Bank | answer 30 questions aloud without notes |
| 7 | Mock Viva, Live Evaluation Guide | rehearse the demo with a partner typing random inputs |
