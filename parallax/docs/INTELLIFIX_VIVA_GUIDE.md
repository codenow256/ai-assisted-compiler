# IntelliFix: viva questions and answers

Short, honest answers you can say aloud. Numbers come from `evaluation/results/summary.json` (held-out test set, 540 synthetic cases, τ = 1.5) and match the Research & Method page. Explanations of the terms are in [`INTELLIFIX_BEGINNER_GUIDE.md`](INTELLIFIX_BEGINNER_GUIDE.md) Part 5.

## A. Motivation and basics

**1. Why did you choose this project?**
Syntax errors are the first wall every programming student hits. Compiler messages say where the parser got stuck, not what was meant, and they never say when several fixes are possible. We wanted a real compiler that explains errors, proposes fixes it has actually checked, and admits when it cannot know the intent.

**2. What is the difference between a lexer and a parser?**
- The **lexer** (Flex) groups characters into tokens: names, numbers, operators, keywords. It checks *spelling*, e.g. `$` is not a MiniC character, or `2147483648` is too large.
- The **parser** (Bison) checks the *order* of tokens against the grammar and builds the tree.
- Example: `x x x;` is fine for the lexer but rejected by the parser.

**3. What is an AST?**
The abstract syntax tree is the structure the parser builds: Program → Function → Block → statements → expressions. It leaves out punctuation (`;`, `(`, `)`), because the tree shape already records what they meant. For example, `1 + 2 * 3` has `*` *below* `+`, which says the multiplication happens first.

**4. How does syntax-error detection work?**
- Bison generates an LALR(1) parser. It reads tokens left to right with a stack, deciding at each step from one look-ahead token.
- It reports an error at the first token for which no grammar action exists.
- We enable LAC (look-ahead correction), so the list of expected tokens is exact.
- The error is often detected one token *after* the real mistake. For a missing `;`, it shows up at the next line.

**5. What is MiniC, and why not full C?**
MiniC is our teaching subset defined in `minic.y`:
- **has:** types `int float char bool void`, functions, `if/else`, `while`, `for`, arrays, the usual arithmetic, comparison and logical operators;
- **does not have:** pointers, structs, `++`, `+=`, strings, `#include`, `switch`.

The lexer recognises those C features and reports them as *unsupported* instead of failing confusingly. A small grammar keeps the repair search bounded and the results checkable.

## B. The repair engine

**6. How are repairs generated?**
- At the first error, the engine tries every **insertion, deletion or replacement** of one token at the error and up to 3 tokens before it. Inserted tokens come from the exact expected set.
- **Layout generators** look further back, e.g. a line that ends without `;`, or indentation suggesting a missing brace.
- If no single edit works, it tries **pairs** of edits (at most 2 per error).
- Example: the missing-semicolon sample generates 98 candidates.

**7. How is a repair validated?**
- Each candidate is applied to the token stream and the **real parser runs again**.
- It survives only if the parser gets at least 3 tokens past the edit. Candidates that fail in the same place, fail earlier, or only move the error are rejected with that reason.
- In the website, any fix you apply is re-analyzed again, and you see which error reports disappeared.
- Budget: 30,000 parser runs or 4 seconds.

**8. How are candidates ranked?**
- Candidates producing the same AST are grouped, since different edits can give the same program.
- Each group gets a score: a sum of named evidence with **hand-set** weights:
  - edit cost (−1 per unit)
  - resolves all errors (+2)
  - a `;` at a line end (+0.75)
  - deleted content (−0.75)
  - invented placeholder (−1.5)
  - distance from the error (−0.2 per token)
  - name warnings and later-error stability
- Every contribution is shown in the website under *Why this score*.

**9. Is the score a probability?**
No. It is an uncalibrated sum used only to rank options. The *margin* (best minus runner-up) is a score difference. We never present it as a likelihood.

**10. Why can a repair be ambiguous?**
Because different programs can all be valid. `int c = a b;` can become `a + b`, `a - b` or `a * b`, and all three parse. `price + ;` can lose the `+` or gain a value. The code alone does not contain the intent.

**11. How does the system decide when to abstain?**
It recommends only if all of these hold:
1. the best plan is a complete, parser-valid program;
2. it invents nothing: no placeholder name or value, and no deletion of code hidden in an unterminated comment;
3. it leads every structurally different alternative by at least **τ = 1.5**.

Otherwise:
- if 3 fails: `MULTIPLE_PLAUSIBLE`, and the website asks a question;
- if 1 or 2 fails: `LOW_CONFIDENCE`.

τ was chosen on the **dev** split only. The rule: the most coverage while keeping dev selective risk ≤ 10%. At τ = 1.5 the dev risk was 5.5%.

**12. How does the clarification question work?**
- The options are the engine's real plans, plus a fill-in, plus "write the line yourself".
- The website sends your answer to the real parser. **Use this answer** is enabled only if it parses.
- Then you inspect the tree, apply, and the program is re-analyzed.
- Nothing is invented. Suggested names come only from names already declared earlier in your code.

**13. How do you handle several errors?**
- After fixing the first error, the engine re-parses and repairs the next one, exploring several "hypothesis lanes" (different first fixes). It returns the best complete plan.
- The website labels the first report as reliable. Later reports are labelled "likely a consequence" or "likely independent", from a real re-parse of the best first fix, and always "likely, not proven".

## C. Results

**14. How was the system evaluated?**
- 30 hand-written correct MiniC programs were mutated with seeded token mutations, giving 900 cases (720 single-error, 180 two-error).
- The split is **by program**: dev 360 cases (used only to choose τ) and test 540 cases (reported).
- The reference answer is the original program's AST.
- Systems compared:
  - IntelliFix;
  - local least-cost repair over the same candidates;
  - five ablations;
  - raw parser diagnostics;
  - panic-mode recovery;
  - CPCT+ (grmtools) as an external reference.

**15. What are the strongest results?**
- **Top-1 repair equals the intended program:** 71.5% (386/540) vs 55.2% (298/540) for least-cost repair. The difference is +16.3 points, with a paired bootstrap 95% CI of +13.1 to +19.4.
- **Wrong-but-confident repairs:** fall from 28.5% (forced answer) to **6.1%** with abstention.
- When IntelliFix does recommend (50.7% of cases), it is right **88.0%** of the time.
- The first repair edit is at the exact error position in 86.7% of cases, vs 76.3% for the raw parser's detection point.

**16. What does the ablation show?**
- **Layout evidence** is the largest contributor: removing it drops top-1 to 62.6% (−8.9 points, CI +6.7 to +11.3).
- **Stability evidence** showed no measurable effect (CI −0.4 to +0.9 points). We report that openly.
- **AST grouping** leaves top-1 unchanged and raises coverage from 48.9% to 50.7%.
- **Abstention** leaves top-1 unchanged and is what removes most confident mistakes.

**17. What is novel or useful about IntelliFix?**
We do not claim a new algorithm. Bounded LR repair is known. The contribution is an inspectable, integrated pipeline:
- layout-aware candidates;
- named, explainable evidence;
- AST grouping;
- an explicit abstain-or-ask policy, tuned on held-out data;
- a teaching interface that validates every suggestion with the real parser.

Everything is measured against a fair baseline, on the same candidates.

## D. Hard questions

**18. Your data is synthetic. Why should we believe it?**
You should believe only what it measures: performance on **token-level mutations of 30 hand-written programs**. Real student errors may be different, e.g. several related mistakes or misunderstood syntax. We did not evaluate on real student code. That is the most important next step. The split by program at least prevents the model from tuning on the programs it is tested on.

**19. Half the time it refuses to answer. Isn't that weak?**
- It is a deliberate trade-off. Forced to always answer, it is wrong-but-confident in 28.5% of cases. That is harmful for a learner.
- With abstention it answers 50.7% of the time and is right 88.0% of those times. The other half get a question with the real options.
- Our simulation (not a user study) found the intended repair among the offered options in 153 of 256 abstained cases (59.8%). Whether real users pick it is unmeasured.

**20. Where is it weakest?**
- When the mutation **deleted content** (a lost name or value), top-1 is only 24.0% (104 cases), and IntelliFix recommends in just 19.2% of them. The information is gone, so no system can recover it.
- **Operator choice** (`a b`) gets 44.3%.
- **Structural** errors (delimiters, brackets) get 89.1%.

**21. Is a parsed repair a correct program?**
No. Parser acceptance means the program follows the grammar. `x = x - 1` and `x = x + 1` both parse. IntelliFix checks syntax and name use, not types or behaviour. The website says this every time it recommends.

**22. What is a partial AST, and can you trust it?**
- When the parser hits an error, panic-mode recovery skips to the next `;` or `}` and continues. The tree it builds contains **Error** nodes where text was skipped.
- It is useful for seeing what *was* understood. It is **not** a valid program's tree, so the website labels it "Partial tree" and never fills in missing nodes.
- The complete tree is shown only for the repaired program, which is really parsed.

**23. Why don't you just compare with CPCT+ and say you are better?**
- CPCT+ ran on the same cases and its top-1 was 48.0%.
- It optimises a different objective: minimal-cost repair sequences across the whole file, using its own grammar format.
- One synthetic benchmark is not enough for a general claim. So we report it as a reference only, not as superiority.

**24. Are the weights tuned to the test set?**
- No. The weights were fixed by hand and documented in `repair.hpp`.
- τ was chosen on the dev split only; the test split was used once for reporting.
- But the weights are a heuristic, not learned. A learned model might do better, or might overfit.

**25. What happens with input you didn't plan for?**
Every input gets a specific, honest response:
- empty or comments-only input;
- unsupported C (no repair, a rewrite hint);
- an unterminated comment (no fix that would delete hidden code);
- nesting beyond the parser's 5000-entry stack (a capacity limit);
- over 64 KB (refused);
- a missing compiler (the real error and the build command, never fake output).

Seeded fuzzing of 800 random inputs found 0 crashes or invariant violations.

**26. How does the website make sure results belong to the current code?**
- Every result stores the exact text it was computed for. If you type afterwards, the page says "You changed the code since this analysis".
- Older requests are cancelled, and late responses are ignored.
- Applying a fix always triggers a fresh analysis.

**27. What would you improve next?**
- Evaluate on real student error corpora.
- Run a user study of the clarification flow.
- Learn or calibrate the evidence weights, then test whether a calibrated probability is meaningful.
- Add type checking, so semantic errors can be detected.
- Support more of C.
- Test on Windows and macOS browsers.

## E. One-minute summary to memorise

"IntelliFix is a real Flex/Bison compiler for MiniC with a repair engine on top. When the parser rejects code, the engine:
- tries small edits near the error;
- keeps only the ones the real parser accepts;
- groups them by the program they produce;
- ranks them by named evidence.

It recommends only when one fix clearly wins. Otherwise it asks the user and checks the answer with the parser.

On 540 held-out synthetic cases it gets the intended program 71.5% of the time vs 55.2% for least-cost repair over the same candidates, and abstention cuts confident wrong repairs from 28.5% to 6.1%. The limits: synthetic data, no user study, syntax only, and MiniC rather than C."
