# IntelliFix: verified demo examples and the live demonstration script

Every "expected output" below was observed on the real compiler during the audit of 25 Oct 2026 (τ = 1.5, Chromium). It is backed by either the browser test suite (`frontend/tests/e2e/run-e2e.mjs`) or the audit runs in [`INTELLIFIX_TEST_MATRIX.md`](INTELLIFIX_TEST_MATRIX.md). If the screen ever differs, describe what the screen shows; never read the expected output aloud as if it appeared.

## 1. Start the website locally (no internet needed)

Run these once per laptop, from the repository root:

```bash
cd parallax
cmake -S compiler -B compiler/build -DCMAKE_BUILD_TYPE=Release && cmake --build compiler/build
python3 -m venv .venv && . .venv/bin/activate && pip install -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
```

Run this every time:

```bash
cd parallax && . .venv/bin/activate && ./scripts/run_backend.sh
# open http://localhost:8000
```

On Windows, follow the PowerShell steps in `README.md` (marked unverified on a real Windows machine).

**Checklist before the professor arrives:**
1. The sidebar badge says **Compiler 1.0.0** (green).
2. Workspace → Load a sample… → *Missing semicolon* → **Analyze** shows step 2 *Missing delimiter*.
3. Zoom the browser to 125–150% for the projector.
4. Press the eraser (Clear) so you start with an empty editor.
5. Keep this document and the screenshots folder open in another window.

## 2. Demonstration examples

For every example: paste into the **Workspace** editor ("Your code", left), unless it says to use the sample menu.

### A. Valid program: successful compilation

```c
int square(int n) {
  return n * n;
}

int main() {
  int total = 0;
  int i;
  for (i = 0; i < 3; i = i + 1) {
    total = total + square(i) * 2;
  }
  return total;
}
```

- **Clicks:** **Analyze**.
- **Expected:** step 2 shows *Valid MiniC*, "Your program is valid MiniC: it parses without syntax errors." The Lexer box is green, the Parser box says "accepted; built an AST of 38 nodes", and the Meaning box says "not checked". *What your program contains* lists: 2 functions (`int square(n)`, `int main()`), 2 local variables, 1 loop, 2 returns, 3 assignments, 1 function call (`square`), operators `*` `<` `+`. Step 3 is *not needed*.
- **Feature:** lexer → parser pipeline; syntax vs semantics.
- **Point out:** the three boxes. Valid syntax does not mean the program does what you want.
- **Say:** "The lexer turned the characters into tokens, the parser checked their order against our grammar and built a tree. IntelliFix checks syntax only. Whether `total` is right is a semantic question we do not check."
- **If it differs:** if the badge is red, the compiler is not built (§5).

### B. Syntax error with a clear diagnosis

- **Clicks:** Load a sample… → **Missing semicolon** → **Analyze**.
- **Expected:** *Missing delimiter*. "Line 4: the parser did not expect the type keyword `int` here." Then "… the previous line (3) is missing its `;` — the parser can only notice it here, one line later." Expected here: an operator or `;` or `,`.
- **Feature:** exact error detection with Bison + LAC; detection point vs cause.
- **Point out:** the error is underlined on line 4, but the explanation names line 3.
- **Say:** "An LR parser reports where it gets stuck, not where the mistake is. IntelliFix explains that gap using the exact expected-token set."
- **If it differs:** make sure you analyzed the sample, not edited text (top bar shows *edited*).

### C. One error, several candidate repairs

Continue from B:
- **Clicks:** **Compare fixes →**.
- **Expected:** a green **Recommended** card: *Insert ; at 3:16*, "score gap of 2.00 (threshold τ = 1.5)". Below, two alternative cards: *Replace `int` with `,` at 4:3* (score −0.25, "Scores 2.00 lower than option 1; costs more to edit (1.5 vs 1); edits a different place") and *Replace `int` with `;`* (score −4.00). Both parse. **Why this score** opens the evidence bars.
- **Feature:** generate → validate → rank; explainable comparison.
- **Point out:** every card was re-parsed by the real parser. The score is a sum of named, hand-set evidence weights, and it **ranks**: it is not a probability.
- **Say:** "Several edits make this file parse. The winner is cheaper, fixes everything, and matches the layout cue of a line ending without `;`. It leads by 2.00, above our threshold of 1.5, so IntelliFix recommends it."

### D. Ambiguity resolution: IntelliFix asks instead of guessing

```c
int main() {
  int price = 5;
  int total = price + ;
  return total;
}
```

(Also available as Load a sample… → *Missing expression after +*.)

- **Clicks:**
  1. **Analyze** → the **Fixes** box in the step indicator.
  2. Choose *Fill in the missing value or expression yourself*.
  3. Click the chip **price**.
  4. **Check with the parser** → **Use this answer**.
- **Expected:**
  - category *Missing expression or name*;
  - "What is ambiguous: `+` on line 3 has nothing valid after it … (score gap 0.50, below the threshold τ = 1.5)";
  - the question **"Is the `+` extra, or is something missing after it?"**;
  - options: delete `+`, replace `+` with `;`, fill in, something else;
  - after the check: "Valid MiniC". Step 4 opens: *Partial tree → complete tree*, with the Error node replaced by `DeclStmt int`.
- **Feature:** abstention + clarification validated by the real parser.
- **Point out:** *Use this answer* is disabled until the parser accepts the answer. `total` is not suggested because it is still being declared. IntelliFix never invents the value.
- **Say:** "Here the code alone cannot tell us the intent. Deleting `+` and adding a value both parse. Instead of guessing, IntelliFix asks, and checks our answer with the real parser."
- **If it differs:** click **Analyze** again after any edit.

### E. Expression diagram

```c
int f(int a, int b, int c) {
  return a + b * c;
}
```

- **Clicks:** paste → **AST Explorer** (sidebar) → click the row `Binary +`. Then click the `;` in the source pane.
- **Expected:**
  - The node card shows "Inside `Return` as **the returned value**", children *left operand: Ident a*, *right operand: Binary \**.
  - Tokens it absorbs: `+` "stored as the operator (op)".
  - A diagram with `+` on top, `a` and `*` below, `b` and `c` under `*`.
  - The note "`b * c` is grouped first: `*` binds tighter than `+` …".
  - The grammar rule `add_expr → add_expr '+' mul_expr`.
  - Clicking the `;` selects `Return`.
- **Feature:** precedence encoded in tree shape; grammar ↔ tree; source ↔ node.
- **Say:** "Parentheses and semicolons do not become nodes; the shape of the tree carries their meaning. The multiplication is lower in the tree because it is lower in the grammar's rule chain."

### F. Exploring a full AST

Use example A, then open the **AST Explorer**.

- **Clicks:** start buttons *the function square* / *the first statement*; **Collapse all** / **Expand all**; on the `For` row, **next sibling →** (goes to `Return`, the next statement of `main`); type `square` in **Find:**.
- **Expected:** indentation shows containment (Program ⊃ Function ⊃ Block ⊃ statements ⊃ expressions). Grey roles show *initialisation*, *condition*, *update*, *body* under `For`. Search marks exactly two rows: `Function square` and `Call square` (the *left operand* of `+` on line 9).
- **Feature:** hierarchy, roles, navigation, search.

### G. Apply, verify, undo

Continue from B/C:
- **Clicks:** **Use this fix** → (step 4 Tree) → **Apply & verify →** → **Apply to my code** → then **Undo repair**.
- **Expected:**
  - **Verified: the compiler re-parsed your code and accepts it**, with **Disappeared (1)**, still reported (0), new (0).
  - The editor shows `int total = 0;`.
  - After Undo the original text is back and step 2 shows *Missing delimiter* again.
- **Feature:** a fix only counts after a real re-analysis; reversible.
- **Say:** "IntelliFix does not trust its own suggestion. After applying, it runs the lexer, parser and engine again and shows which error reports disappeared."

For a stronger version, use Load a sample… → **Two errors**:
- step 2 shows 3 error reports with roles;
- the recommended plan makes 2 edits (insert `;` at 3:16, then `)` at 4:14; score gap 3.50);
- after applying: *Disappeared (3)*.

### H. Honest limitation and abstention

```c
int main() {
  int i = 0;
  i++;
  return i;
}
```

- **Clicks:** **Analyze** → **Fixes**.
- **Expected:**
  - *Unsupported C construct*: "This is C, not MiniC …" and "increment/decrement operator '++' is not part of MiniC; write x = x + 1".
  - Step 3: "IntelliFix does not propose a fix here". The parser-accepted edits are listed as *not offered, because they change what the program means*, and you can write line 3 yourself.
- **Say:** "Deleting `++` would parse, but it changes the program. So IntelliFix refuses to repair and explains the rewrite instead."

Alternative abstention: `int main() {\n  int = 42;\n  return 0;\n}` gives *LOW_CONFIDENCE*: "What should the name be?". The only mechanical fix invents `__hole`, which IntelliFix will not apply for you.

## 3. Live demonstration (about 9 minutes)

| Time | Say | Click | Visible | Concept for the professor |
|---|---|---|---|---|
| 0:00–0:45 | "Compilers report where they get stuck, not what we meant. IntelliFix keeps a real compiler front end and adds a repair engine that checks every suggestion with the real parser and asks when it is not sure." | — (Workspace open, badge green) | three sidebar destinations; five steps | problem and approach |
| 0:45–1:45 | Example A text | paste A → **Analyze** | *Valid MiniC*; Lexer → Parser → Meaning | lexer vs parser; syntax ≠ semantics |
| 1:45–3:00 | Example B | sample *Missing semicolon* → **Analyze** | detection on line 4, cause on line 3; expected tokens | LALR(1), LAC, detection vs cause |
| 3:00–4:00 | Example C | **Compare fixes →**, open *Why this score* | Recommended, gap 2.00 ≥ τ 1.5; alternatives | candidate generation, validation, evidence ranking; score ≠ probability |
| 4:00–4:45 | Example G | **Use this fix** → **Apply & verify** → **Apply** | *Verified*, Disappeared (1) | revalidation, undo history |
| 4:45–6:15 | Example D | paste D → **Analyze** → **Fixes** → fill in `price` → **Check with the parser** → **Use this answer** | the question; "Valid MiniC"; partial → complete tree | abstention, clarification, partial trees |
| 6:15–7:30 | Example E | paste E → **AST Explorer** → `Binary +` → click `;` | diagram, grammar rule, absorbed tokens | AST vs source, precedence, grammar ↔ tree |
| 7:30–8:00 | Example H | paste H → **Analyze** → **Fixes** | refusal with reason | honest limits, MiniC ≠ C |
| 8:00–9:00 | "On 540 held-out synthetic cases, evidence ranking gets the intended program in 71.5% vs 55.2% for least-cost repair over the same candidates. Abstention cuts confident wrong repairs from 28.5% to 6.1%, at 50.7% coverage. The data are synthetic and there is no user study." | **Research & Method** | the two charts; limitations | evaluation, trade-off, limits |
| 9:00 | "Questions? You can type your own code." | Workspace, Clear | — | — |

If time is short, drop F and H. Never drop D: it is the main differentiator.

## 4. Backup plan

| Problem | What to do |
|---|---|
| Badge *Backend offline* | in the terminal: `cd parallax && ./scripts/run_backend.sh`, then reload. Your editor text is kept by the browser. |
| Badge *Compiler missing* | `cmake --build compiler/build` (it was built before; check you are in `parallax/`). The UI then shows "Compiler not built" with the exact command; this is a good honesty example in itself. |
| Port 8000 busy | `PORT=8001 ./scripts/run_backend.sh` and open `http://localhost:8001` |
| Browser misbehaves | use the command line, which shows the same compiler output: `./compiler/build/parallaxc analyze --file examples/02_missing_semicolon.mc`, `./compiler/build/parallaxc repair --tau 1.5 --file examples/02_missing_semicolon.mc`, `./compiler/build/parallaxc tree < examples/01_valid_basic.mc` |
| Laptop fails completely | show the screenshots in `docs/images/walkthrough/v2-*.png` (index: `docs/IntelliFix_Visual_Walkthrough.md`) or the deck `deliverables/IntelliFix_Final_Presentation.pptx`. **Say that they are screenshots of a real run, not live output.** |

Nothing in the demo needs the internet: the compiler, backend and website all run locally.

## 5. Do and don't while presenting

- **Do** say "the parser accepts it", "likely", "on this synthetic benchmark".
- **Don't** say:
  - "it understands C" (it understands MiniC);
  - "the score is a probability";
  - "it always finds the right fix";
  - "students learn better" (no user study);
  - "better than CPCT+".
- If a question goes beyond what you know, say: "We have not measured that; here is how we would."
