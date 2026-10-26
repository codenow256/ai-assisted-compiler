# IntelliFix: beginner's guide to the whole project

*IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction*

This guide assumes no compiler background. Every example output below was produced by the real compiler in this repository (`parallaxc`, branch `feature/parallax-syntax-repair`, 25 Oct 2026). Nothing is mocked.

**Companion documents:**
- [`INTELLIFIX_TEST_MATRIX.md`](INTELLIFIX_TEST_MATRIX.md): what was tested and the results.
- [`INTELLIFIX_DEMO_SCRIPT.md`](INTELLIFIX_DEMO_SCRIPT.md): examples and the live demo.
- [`INTELLIFIX_VIVA_GUIDE.md`](INTELLIFIX_VIVA_GUIDE.md): professor questions.

---

## Part 1. What the project is

### 1.1 The problem in one paragraph

When a program has a syntax error (for example a missing `;`), a normal compiler stops and prints something like `unexpected keyword 'return'`. That message has three weaknesses:

- It points to where the compiler **noticed** the problem, which is often one line **after** the real mistake.
- It does not say how to fix it.
- When several fixes are possible, nothing helps you choose.

IntelliFix keeps a real compiler front end and adds a **repair engine**. The engine tries many small edits, checks each one with the real parser, ranks the survivors by named evidence, and then does one of two things:

- If one fix is clearly better, it **recommends** that fix.
- If it is not sure, it **asks the user** instead of guessing.

### 1.2 What a compiler is, and why this project needs one

A compiler translates source code into something a machine can run. It works in stages. IntelliFix implements only the **front end**: the stages that read the code and check its structure.

```
source text ──► LEXER ──► tokens ──► PARSER ──► AST (tree)
                                        │
                                        └─ syntax error? ──► REPAIR ENGINE ──► ranked, re-checked fixes
```

IntelliFix does **not** generate machine code and does **not** run programs. It needs a real parser because a repair only counts as valid if the real grammar accepts it. The engine never judges a repair "by eye".

### 1.3 MiniC: the language IntelliFix understands

IntelliFix does **not** understand all of C. It understands **MiniC**, a small C-like teaching language defined in `compiler/grammar/minic.y`.

| MiniC has | MiniC does not have (the lexer reports them as *unsupported*) |
|---|---|
| types `int float char bool void` | `struct union enum typedef`, `long short double unsigned …` |
| functions with parameters, calls | `switch case default do goto sizeof static const …` |
| `if`/`else`, `while`, `for`, `return`, `break`, `continue` | `++ --`, `+= -= *= …`, `& | ^ ~ << >> -> ? :` |
| `+ - * / %`, `== != < <= > >=`, `&& || !`, unary `-` | string literals `"…"`, `#include` / preprocessor |
| arrays `int a[10];`, `a[i]` | pointers, structs |
| `true` / `false`, char literals `'x'` | |

Other limits:
- Integers must fit in 32 bits (at most 2147483647).
- Names can be at most 255 characters.
- Input can be at most 64 KB.
- Nesting is limited by the parser stack (5000 entries).

---

## Part 2. The pipeline, stage by stage, with a real example

The same small program is followed through every stage:

```c
int main() {
  int x = 1 + 2 * 3;
  return x;
}
```

### 2.1 The lexer: characters → tokens

**What it does.** The lexer (Flex, `compiler/grammar/minic.l`) reads the text character by character and groups it into **tokens**: the "words" of the language. It also throws away spaces and comments.

**Real output** (`parallaxc lex`):

```
INT(int) IDENT(main) LPAREN(() RPAREN()) LBRACE({) INT(int) IDENT(x) ASSIGN(=)
INT_LIT(1) PLUS(+) INT_LIT(2) STAR(*) INT_LIT(3) SEMI(;) RETURN(return) IDENT(x) SEMI(;) RBRACE(})
```

Each token has a **kind** (`IDENT`, `PLUS` …), its **text** (`x`, `+`) and its exact position (line, column, byte offset).

**Errors the lexer catches** are *lexical errors*: problems with individual characters or words, found **before** parsing. Examples:
- `$`
- the number `2147483648`
- a name longer than 255 characters
- a `/*` comment that never ends
- C features MiniC leaves out, such as `++` or `#include` (reported as *unsupported*)

The lexer does **not** check order. `x x x` is three perfectly valid tokens.

### 2.2 The parser: tokens → structure

**What it does.** The parser (Bison, `compiler/grammar/minic.y`) checks whether the **order** of tokens follows MiniC's grammar. A grammar is a set of rules such as:

```
return_stmt → 'return' expr ';'
add_expr    → add_expr '+' mul_expr
mul_expr    → mul_expr '*' unary
```

Bison turns the rules into an **LALR(1) parser**. It reads tokens left to right, keeps a stack, and decides at each step using one token of look-ahead.

**How a syntax error is detected.** Delete the `;` after `3`:

```c
int main() {
  int x = 1 + 2 * 3
  return x;
}
```

Real output (`parallaxc analyze`):

```
unexpected keyword 'return' at line 3, column 3
expected: + - * / % == != < <= > >= && || ; ,
```

The parser accepted everything up to `3`, then saw `return`, which no rule allows there. IntelliFix enables Bison's **LAC** (look-ahead correction), so the "expected" list is **exact**: precisely the tokens that could legally come next.

Notice that the error is *detected* on line 3, although it was *made* on line 2. Explaining that gap is one of IntelliFix's jobs.

### 2.3 The AST: structure without punctuation

When parsing succeeds, the grammar actions build an **abstract syntax tree** (AST). Real output (`parallaxc tree`):

```
Program
  Function type=int name=main
    Block
      DeclStmt type=int
        VarDecl name=x
          Binary op=+
            IntLit value=1
            Binary op=*
              IntLit value=2
              IntLit value=3
      Return
        Ident name=x
```

**How it differs from the source code:**
- **No punctuation nodes.** `;`, `(`, `)`, `{`, `}` and `,` are not in the tree. The tree shape already records what they meant.
- **Precedence is in the shape.** `*` sits *below* `+`, so `2 * 3` is computed first. If you wrote `(1 + 2) * 3`, `+` would be below `*`, and the parentheses would still not appear as nodes.
- **Keywords become node kinds.** `return` becomes a `Return` node. Names and values become attributes (`name=x`, `value=1`).

The compiler produces **26 node kinds**:

| Group | Node kinds |
|---|---|
| program structure | Program, Function, Param |
| scope | Block |
| statements | DeclStmt, VarDecl, Assign, If, While, For, Return, Break, Continue, ExprStmt, EmptyStmt |
| expressions | Binary, Unary, Call, Index |
| names and values | Ident, IntLit, FloatLit, CharLit, BoolLit |
| placeholders | Empty (an omitted `for` clause), Error (text skipped during error recovery) |

**Partial trees.** When the code has a syntax error, the parser uses *panic-mode recovery*: it skips to the next `;` or `}` and continues. The result is a **partial tree** (`recovered_ast`) that contains **Error** nodes where text was skipped. It is **not** a valid program's AST, and the website always labels it as partial.

### 2.4 The repair engine: fixes, ranked and re-checked

The engine is in `compiler/src/repair_engine.cpp`. For the missing-`;` example, the real numbers are: **98 candidate edits generated, 16 accepted by the parser, 16 structurally different programs**. The work happens in four steps.

**1. Generate candidates**
- Around the first error (the error token and 3 tokens before it), try every **insertion, deletion or replacement** of one token.
- Inserted tokens are taken from the parser's exact expected set.
- **Layout-informed** generators reach further back. Example: "a line that ends without `;` and the next line starts a new statement".
- Only if no single edit works, it tries **pairs of edits** (at most 2 edits per error).

**2. Validate with the real parser**
- Every candidate is applied to the token stream and **parsed again**.
- A candidate is kept only if the parser gets at least 3 tokens past the edit.
- Rejected candidates get a recorded reason:
  - `same-location`: still fails at the same place.
  - `earlier-error`: creates an earlier error.
  - `defers-error`: only moves the error a little.
- Budget: at most 30,000 parser runs and 4 seconds.

**3. Group and rank**
- Candidates that produce the **same AST** form one group (an "AST class"). Different edits can lead to the same program.
- Each class gets a **score**: a sum of named evidence with **hand-set weights**. These were chosen by the designers; nothing was learned by machine learning.
  - edit cost (−1 per edit, −1.5 for a replacement)
  - resolves all errors (+2)
  - layout cues such as "`;` at a line end" (+0.75)
  - deleted content (−0.75)
  - invented placeholder (−1.5)
  - distance from the error
  - stability of later errors
- Real scores for our example:

| Rank | Candidate | Score | Evidence |
|---|---|---|---|
| 1 | insert `;` at 2:20 | **+1.75** | edit cost −1, resolves all +2, line-end `;` +0.75 |
| 2 | replace `return` with `;` | −0.25 | cost −1.5, resolves all +2, deleted content −0.75 |
| 3 | replace `return` with `+` | −1.00 | … plus a name warning −0.75 |

**4. Decide**
- The **margin** is the score of the best class minus the score of the runner-up: 1.75 − (−0.25) = **2.00**.
- If the margin is at least **τ = 1.5** and the fix yields a complete valid program, the status is **RECOMMENDED**.
- τ ("tau") is the decision threshold. It was chosen on a separate development data set.
- Otherwise the engine **abstains**:

| Status | When |
|---|---|
| `RECOMMENDED` | one fix clearly wins and the program parses |
| `MULTIPLE_PLAUSIBLE` | several structurally different fixes have similar scores (margin < τ): IntelliFix asks you |
| `LOW_CONFIDENCE` | the best fix must **invent** a name or value (`__hole`, `true`), or would delete code hidden in an unterminated comment |
| `NO_SAFE_REPAIR` | no small edit near the error lets the parser continue |
| `BUDGET_EXHAUSTED` | the search ran out of parser runs or time |
| `UNSUPPORTED_CONSTRUCT` | the error is a C feature MiniC leaves out, or the nesting limit; rewriting could change the meaning, so no repair |
| `NO_REPAIR_NEEDED` | the program is valid |

**Several errors.** After fixing the first error, the engine re-parses and repairs the next error. It explores several "hypothesis lanes" (different first fixes) and returns the best complete **plan**.

**Important honesty points:**
- The **score is not a probability**. It ranks options. A margin of 2.00 does not mean "200% sure" or "90% likely".
- **Parser acceptance is not semantic correctness.** A repaired program can parse and still be wrong. IntelliFix checks syntax and name use, not types or behaviour.
- The weights are a **heuristic**. They are documented and inspectable, but not learned or proven optimal.

### 2.5 Ambiguity resolution: when IntelliFix asks

Example: `int total = price + ;`. The real engine finds three structurally different fixes with similar scores:

| Plan | Edit | Score |
|---|---|---|
| 1 | delete `+` | 0.80 |
| 2 | replace `+` with `;` | 0.30 |
| 3 | insert placeholder `true` | −0.50 |

The margin is 0.50, which is less than τ = 1.5. So the status is `MULTIPLE_PLAUSIBLE`, and the website asks a targeted question built from those plans: **"Is the `+` extra, or is something missing after it?"** The possible answers are:

- one of the real plans;
- **filling in** the missing value yourself (the website suggests `price`, a name declared earlier);
- writing the whole line yourself.

Whatever you choose is **checked by the real parser** before you can use it. IntelliFix never invents the missing value.

### 2.6 How the website talks to the compiler

```
Browser (React app)  ──HTTP JSON──►  FastAPI backend (Python)  ──stdin/stdout──►  parallaxc (C++)
```

- **Frontend** (`frontend/src/`): React + TypeScript, built with Vite into `frontend/dist`. The backend serves those files, so one URL (`http://localhost:8000`) gives you everything.
- **Backend** (`backend/app/main.py`): receives the code and runs the compiler binary as a separate process (`backend/app/compiler.py`). Safety rules:
  - the source is passed on stdin;
  - there is no shell and no temporary files;
  - there is a 15-second timeout;
  - at most 4 compiler processes run at once.
- **Main endpoints:**

| Endpoint | What it does |
|---|---|
| `/api/lex` | tokens |
| `/api/parse` | tokens + parse + AST |
| `/api/repair` | everything + the repair engine |
| `/api/repair/compare` | parses two programs and compares their ASTs node by node (`backend/app/astdiff.py`) |
| `/api/evaluation/results` | the stored research results |

- **Errors** become typed codes, such as `COMPILER_UNAVAILABLE`, `COMPILER_TIMEOUT` and `INPUT_TOO_LARGE`. The website shows them as they are and never fills in fake results.

### 2.7 What happens when you press Analyze, Apply, Undo

| Action | What really happens |
|---|---|
| **Analyze** | three requests in parallel: lex, parse, and repair. Each result remembers the exact text it was computed for. If you type afterwards, the website marks results as "earlier text". |
| **Check with the parser** | `/api/parse` on the proposed program; the answer is shown as "Valid MiniC" or "Not valid yet" |
| **Apply to my code** | replaces the editor text, saves the old text and its diagnostics in the undo history, then **re-analyzes automatically** |
| **Verify** (step 5) | compares the error reports before and after the re-analysis: disappeared, still reported, new |
| **Undo repair** | restores the previous text and re-analyzes it |
| **Check my fix** (practice) | re-analyzes your own edit and tells you whether it worked |

---

## Part 3. The website, page by page

Start it (see [`INTELLIFIX_DEMO_SCRIPT.md`](INTELLIFIX_DEMO_SCRIPT.md) §1), then open `http://localhost:8000`.

The **sidebar** on the left has exactly three destinations:
- **Workspace**
- **AST Explorer**
- **Research & Method**

At the bottom of the sidebar is the **compiler badge**: green *Compiler 1.0.0* means the compiler binary was found. Red *Compiler missing* or *Backend offline* means no analysis can happen (see §3.5). The moon/sun button switches dark and light themes.

The **top bar** shows:
- the file name (e.g. `untitled.mc`);
- *edited* if you changed a loaded sample;
- *N repair(s) applied*;
- the engine's status for the current text (e.g. *Recommended repair*).

On specialist pages it also shows a **← back** link.

### 3.1 Workspace: the main journey

The **step indicator** across the top has five boxes. Each shows a number (or ✓ when done), a title, and a short status underneath (e.g. *Missing delimiter*, *3 option(s)*, *not needed*). Click a box to jump to that step. The current step is outlined in purple. Steps 2–5 are disabled until you analyze.

The page has two columns:
- **left, "Your code":** the editor;
- **right:** the current step's panel.

On a narrow screen the step panel moves below the editor, and the page scrolls to it when the step changes.

#### Left column: "Your code"

| Control | Meaning |
|---|---|
| **Load a sample…** menu | 12 bundled MiniC samples (valid, missing `;`, two errors, ambiguous operator, …) plus two teaching samples (*Missing expression after +*, *Unterminated comment*). Choosing one replaces the editor text. |
| 📄↑ (open file) | load a `.mc`/`.c`/`.txt` file (max 64 KB) |
| eraser (clear) | empty the editor |
| **Undo repair** (only after applying) | restore the text before the last applied fix |
| editor | type MiniC. The first error is underlined in red after analysis. Line numbers are on the left. |
| bytes counter | `98 / 65,536 bytes`. Over the limit it shows *too large*. |
| *changed since the last analysis* | you typed after analyzing; results are for the earlier text |
| **Analyze** (or Ctrl+Enter) | run lexer + parser + repair engine on the current text |

Your text is saved in the browser, so a page refresh keeps it. Analysis results are **not** saved, so press Analyze again after a refresh.

#### Step 1: Code

A short explanation of lexer → parser → repair engine, plus four quick example buttons (*missing semicolon*, *ambiguous: price + ;*, *two errors*, *valid program*) and **Analyze**. After a successful analysis the page moves to step 2 automatically.

#### Step 2: Diagnosis ("what did the compiler find?")

Read from top to bottom:

1. **Input-type badge and one-line statement.** Examples: *Missing delimiter*, *Missing expression or name*, *Ambiguous repair*, *Several syntax errors*, *Invalid token (lexical error)*, *Unterminated comment*, *Incomplete code*, *Unsupported C construct*, *Too deeply nested*, *No safe repair*, *Valid MiniC*, *Empty input*, *Only whitespace*, *Only comments*. The grey text says what IntelliFix can establish for that kind of input.
2. **Headline** in plain English, e.g. "Line 4: the parser did not expect the type keyword `int` here."
3. **Paragraphs** explaining:
   - what was valid up to the error;
   - what MiniC allows at that point;
   - common patterns (e.g. "the previous line (3) is missing its `;` — the parser can only notice it here");
   - when the top fix changes an earlier line than the one where the error was noticed.
4. **Location button** (📍 `line 3, column 3: …`). Click it to highlight the spot in the editor.
5. **Expected here:** the exact expected tokens, grouped into words.
6. **Lexer → Parser → Meaning panel:**
   - Lexer box: how many tokens, and whether any character was invalid.
   - Parser box: accepted, or where it stopped.
   - Meaning box: always *not checked*, because types and behaviour are outside IntelliFix.

   Green left border = OK, red = problem. This panel shows the difference between a lexical error and a syntax error, and between syntax and meaning.
7. **What your program contains** (valid code only): functions, variables, loops and operators, read from the AST.
8. **"N error reports — which one matters?"** (only when the parser reported several). Each report has a clickable line:column (highlights it) and a role badge:
   - *first error (reliable)*: everything before it parsed.
   - *likely a consequence*: it disappears when only the first error is fixed.
   - *likely independent of the first*: it is still reported after the first is fixed.

   Each badge comes with the evidence sentence and "likely, not proven".
9. **Fix it yourself:**
   - **Show a hint** gives three staged hints, one per click: *Where* → *What MiniC expects* → *Fixes the parser accepted*.
   - **I'll try it in the editor** opens a practice box: edit the code on the left, then press **Check my fix**.
   - The feedback is one of: *Your fix works*, *Progress: the error on line N is gone*, *Not fixed yet*, *Your edit introduced an earlier error*, *Incomplete*, *That is C, not MiniC*, *The lexer rejects a character*.
10. **Next:** the suggested next action.
11. **Compiler internals** (click to expand):
    - the run results for lexer, parser and repair engine;
    - links to the specialist pages: **Token table**, **Parser state & expected tokens**, **All candidates & evidence**, **Hypothesis lanes**, **AST Explorer**;
    - buttons to run one stage at a time.
12. Bottom: **← previous step** and the purple **next** button (e.g. *Compare fixes →*).

#### Step 3: Fixes ("how could it be fixed?")

What appears depends on the engine's decision:

- **Valid code:** "No fix needed". The step shows *not needed* and is skipped by the next button.
- **Recommended** (green card): the fix in words, the changed line (`2  int x = 1  →  int x = 1;`), and badges *parses*, *edit cost*, *score*. Also "leads every structurally different alternative by a score gap of 2.00 (threshold τ = 1.5)". Buttons: **Use this fix** and **I'd rather fix it myself** (back to step 2 with practice on). Below: *Alternatives the engine also checked*.
- **Ambiguous / low confidence** (purple question box):
  - *What is ambiguous* (one sentence), then the **question** in large text.
  - Radio options: the real plans, *Fill in the missing value or expression yourself* (with a text box and chips of names declared earlier), and *Something else: write line N the way you meant it*.
  - **Check with the parser** checks your choice for real. **Use this answer** stays disabled until the parser accepts it. **Leave it unresolved** changes nothing (it can be reopened).
- **Option cards** ("How the N options differ"). Each card shows:
  - the edit and the changed line (red = before, green = after);
  - *parses* / *errors remain*, edit cost, score, *placeholder*;
  - how it differs from option 1, e.g. "Scores 0.50 lower than option 1; costs more to edit (1.5 vs 1)";
  - **Why this score**, which lists each evidence item with a bar (green = adds, red = subtracts);
  - **Choose this fix**. Placeholder plans cannot be chosen; type the real value instead.
- **Unsupported C, nesting limit, no safe repair, unterminated comment:** a banner explains why no fix is proposed, and a **Write line N yourself** box lets you type a line and check it with the parser. For unsupported C, the edits the parser would accept are listed in a closed section, marked *not offered, because they change what the program means*.

#### Step 4: Tree ("what does the fix change in the structure?")

- **With a chosen fix and invalid original code:** *Partial tree → complete tree*. Each **Error** node of the partial tree is listed with the text the parser skipped, and with the real statements that occupy the same lines in the repaired program. Two outlines follow: *Before: partial tree* (Error marked *removed*) and *After: complete AST* (new statement marked *added*).
- **Between two valid programs:** *N structural change(s)*, each change with before → after, the line, and the edit on that line. Both trees are shown with *changed/added/removed* marks.
- **Valid code without a fix:** a compact preview of the AST.
- **Open in the AST Explorer** takes you to the full explorer.

#### Step 5: Apply & verify

- **Before applying:** the diff (red/green lines), a banner saying whether the real parser accepts the repaired program (with the reminder that this is syntax only), and the buttons **Apply to my code** and **Discard this choice**.
- **After applying:** IntelliFix re-runs everything.
  - Green "**Verified**: the compiler re-parsed your code and accepts it", or amber "Applied, but the parser still reports errors".
  - Three boxes: **Disappeared** (struck through), **Still reported**, **New**. Reports are matched by message, because line numbers shift.
  - Buttons **Undo repair** (back to step 2 with the original text) and **Compare the trees**.

### 3.2 AST Explorer

Open it from the sidebar. If nothing has been parsed yet, it parses the current editor text automatically.

**Tabs:**
- **Explore the tree**: the main view.
- **Before & after**: compare two programs' trees.
- **Raw JSON / text**: the exact JSON the compiler printed, plus the indented text form.

**Toolbar:**

| Control | Meaning |
|---|---|
| **Your code / After the fix** | switch between your code's tree and the tree of the chosen (or top-ranked) repaired program; *After the fix* is disabled when there is no repaired program |
| green / amber / blue badge | *Complete AST of your code*, *Partial tree of your code (it has syntax errors)*, or *AST after …* |
| `N nodes · depth D` | size of the tree |
| **Find:** box | marks nodes whose kind, name, operator, value or type contains the text (yellow highlight); closed branches open to show matches |
| **Expand all / Collapse all** | open or close every branch |
| colour legend | program structure (indigo), block/scope (teal), statement (blue), expression (amber), name or value (green), placeholder (red) |

**Three linked panes:**

1. **Source** (left). Your code, read-only. **Click anywhere in the code** and the deepest node containing that spot is selected. Clicking a `;` selects the statement that absorbed it. The selected node's text is highlighted. Below it a **breadcrumb** (`Program › Function main › Block › Return › Binary +`) lets you jump to any ancestor.
2. **Tree** (middle). One row per node:
   - a ▸/▾ triangle to open or close;
   - the grey italic **role in the parent** (e.g. *the condition →*, *left operand →*, *statement 2 →*);
   - a coloured dot (category), the node kind (`Binary`) with its attribute (`+`), and the source lines.

   Keyboard: ↑/↓ move, → opens, ← closes or goes to the parent, Enter selects. Very large trees (over 1,500 visible rows) are drawn partly, with a note saying how many branches are not drawn.
3. **Node card** (right). With nothing selected it shows *How to read the tree* and buttons such as *the function main*, *the first statement*, *an operator expression*, *the Error node*. With a node selected:

| Section | What it tells you |
|---|---|
| title + category | e.g. `Binary +` · expression |
| one-line meaning | e.g. "The operator `+` adds its left and right values." |
| **Place in the tree** | "Inside `Assign` as **the new value**" (click the parent to go up); *Contains:* each child with its role (click to go down); **← previous sibling / next sibling →** |
| **Source** | line/column range and the exact text; **Tokens this node takes for itself** (e.g. `+` *stored as the operator*, `return` *selects the grammar rule*, `;` *punctuation: shapes the parse, leaves no node*) |
| **Expression structure** | only for expressions (and statements that contain one): a top-down **diagram** with operators in circles and operands in boxes, edges labelled *left/right/arg 1*, plus notes such as "`b * c` is grouped first: `*` binds tighter than `+`" or "same precedence: left-associative". Click a diagram node to select it. |
| **Why the parser built it** | the real grammar rule from `minic.y`, e.g. `add_expr → add_expr '+' mul_expr`, and one sentence on why |
| **Technical details** (expand) | kind, attributes, byte offsets, token indices, subtree size, path |

**Why are expression diagrams specialized?** Operators have exactly one or two operands, and precedence is easiest to see in a top-down picture. Statements and blocks have long, ordered child lists (statement 1, 2, 3 …), which the outline shows better, with roles and indentation. So the diagram appears only when the selected node is, or contains, an expression. It never appears for a Function or Param alone.

**Before & after tab.**
- Choose **Before** and **After** from: your current code, your code before the last applied fix, your chosen fix, and options 1…N from the engine.
- Both programs are parsed again. Then you get either a list of structural changes and two marked trees, or (if one side has errors) the partial → complete view.
- Default choices: your code vs your chosen fix, or before vs after the last applied fix, or option 1 vs option 2.

### 3.3 Research & Method

One scrolling page, with every number read from `evaluation/results/summary.json` when the page loads:

1. **The question:** the problem and the research question.
2. **How IntelliFix works:** generate → validate → group & rank → decide, with the real mean counts per test case (about 100 candidates, about 306 parser runs, about 6 distinct options).
3. **Key result:** bar chart of the *top-1 repair has the reference AST* rate on the held-out test set: least-cost baseline **55.2% (298/540)** vs IntelliFix **71.5% (386/540)**, with 95% intervals and the paired bootstrap CI of the difference (+13.1 to +19.4 points).
4. **Reliability vs coverage:** bar chart of *wrong repairs presented with confidence*: without abstention **28.5%**, with abstention **6.1%**. Text: recommends in **50.7%** of cases, and those recommendations are right **88.0%** of the time. Then the labelled **simulation** (153 of 256 abstained cases had the intended repair among the options).
5. **Ablation table:** what happens when one ingredient is removed.
6. **Limitations and future work.**
7. Links: **All results** (the full evaluation page with every table and chart) and **Documentation**.

Part 5 explains what these numbers mean.

### 3.4 Specialist pages (reached from the Workspace or Research page)

| Page | How to get there | What it shows |
|---|---|---|
| Token table (`/lexer`) | step 2 › Compiler internals › Token table | every token: kind, category, lexeme, position; click a row to highlight it and see the Flex rule that produced it |
| Parser state (`/parser`) | … › Parser state & expected tokens | the diagnostic, the exact expected tokens, the LR state with its grammar items and actions, a parse trace, recovery |
| All candidates (`/repair`) | … › All candidates & evidence | every ranked candidate with its evidence bars, the rejected candidates and their reasons, the AST classes, two-candidate comparison |
| Hypothesis lanes (`/hypotheses`) | … › Hypothesis lanes | for several errors: each first-fix hypothesis extended step by step, and which later error sites are stable |
| Full evaluation (`/evaluation`) | Research › All results | all systems, tables, risk–coverage chart, per-category breakdowns, failure examples, a small live evaluation run |
| Learning center, Documentation | Research › links | lessons and all the Markdown docs |

The top bar on these pages shows **← Workspace** (or **← Research & Method**) to go back.

### 3.5 When something does not appear

| You see | Meaning | What to do |
|---|---|---|
| badge *Backend offline*, banner "Backend offline" | the browser cannot reach the backend | start it (`./scripts/run_backend.sh`) and reload; your text is kept |
| *Compiler missing*, banner "Compiler not built" with a cmake command | the backend runs but `parallaxc` is not built | build the compiler (README step 4) |
| "Input too large" | over 64 KB | shorten the code |
| "You changed the code since this analysis" | results are for the earlier text | press **Analyze again** |
| step 3/4/5 disabled | nothing analyzed yet | press **Analyze** |
| *After the fix* disabled in the AST Explorer | no repaired program yet | analyze code with an error in the Workspace |
| "The parser could not build even a partial tree" | the input stopped before any declaration was completed | read the diagnosis in the Workspace; nothing is invented |

---

## Part 4. Implemented, heuristic, simulated, unsupported

| Category | Items |
|---|---|
| **Implemented and real** | lexer, LALR(1) parser with LAC expected sets, AST, partial trees from panic-mode recovery, candidate generation, real parser validation, AST grouping, hypothesis lanes, decision policy, AST comparison, every website number from stored experiment files |
| **Heuristic** (designed rules, not learned) | the evidence weights and the score; τ = 1.5 (chosen on dev data); layout generators; the website's categories, ambiguity questions and "likely consequence / independent" labels (rules over real data); before/after report matching by message; the partial → complete match by line |
| **Simulated** | the 153/256 "clarification" figure: an idealised user who always picks the right option. No real users were tested. |
| **Not supported / not done** | full C; types and semantics; code generation; real student-code evaluation; user studies; Windows/macOS browser testing |

---

## Part 5. The research, in plain English

**What the experiment tests.**
- 30 hand-written correct MiniC programs were automatically broken with small token mutations (delete a `;`, swap an operator, …).
- This gave **900 cases**: 720 with one error and 180 with two.
- They were split **by program** into a *dev* set (360 cases, used only to choose τ) and a held-out *test* set (540 cases, used for the reported numbers).
- Because the original program is known, we can check whether a repair restores it.

**The baseline.** *Local least-cost repair* uses the **same** candidates but simply picks the cheapest edit, with no evidence, no grouping and no abstention. It is a classic approach, so beating it shows the evidence ranking adds something.

**The terms:**

| Term | Meaning | IntelliFix (test) |
|---|---|---|
| **Top-1 AST match** | the top-ranked repair produces exactly the original program's AST (formatting ignored) | 71.5% vs baseline 55.2% |
| **Coverage** | the share of cases where the system *recommends* (does not abstain) | 50.7% |
| **Selective accuracy** | among the recommended cases, the share that are right | 88.0% |
| **Selective risk** | 1 − selective accuracy | 12.0% |
| **Wrong but confident** | wrong recommendations as a share of *all* cases | 6.1% (28.5% without abstention) |
| **Abstention** | refusing to recommend and showing options instead | in 49.3% of test cases |

**Why refuse to guess?** Forced to always answer, IntelliFix is wrong-but-confident in 28.5% of cases. A tool that confidently rewrites code incorrectly teaches the wrong thing and can hide the real mistake. Abstaining cuts this to 6.1% at the cost of answering only half the time. In the other half, the user sees the options and the question.

**Ablation** means switching off one ingredient at a time to see what it contributes:

| Ingredient removed | Effect on the test set |
|---|---|
| layout evidence | top-1 drops 71.5% → 62.6% (−8.9 points, CI +6.7 to +11.3): **the biggest single contributor** |
| stability evidence | 71.3%, no measurable effect (CI −0.4 to +0.9 points) |
| AST grouping | same top-1; coverage 48.9% vs 50.7% |
| abstention | same top-1; wrong-but-confident 28.5% instead of 6.1% |

**Supported claims:**
- On this synthetic benchmark, evidence ranking beats local least-cost repair over the same candidates by 16.3 points top-1 (paired CI +13.1 to +19.4).
- Abstention cuts confident wrong repairs from 28.5% to 6.1%.
- Layout evidence is the largest contributor.

**Not supported:**
- "Works on real student code" (synthetic only).
- "Better than CPCT+ in general". CPCT+ ran on the same cases and scored 48.0% top-1, but it optimises a different objective, so no general superiority is claimed.
- "Always correct".
- "The score is a probability".
- "Users learn better", or "the clarification flow helps people" (no user study).

**Weak spots to know:**
- When the mutation **deleted content** (e.g. a variable name), no system can know what was there. IntelliFix's top-1 is only 24.0% on those 104 cases, and it recommends in just 19.2% of them.
- For **operator choice** (`a b` → `+`? `-`?), top-1 is 44.3%.
- For **structural** errors, top-1 is 89.1%.

---

## Part 6. Which file does what

| Path (under `parallax/`) | Responsibility |
|---|---|
| `compiler/grammar/minic.l` | the lexer: token rules, unsupported C, lexical errors |
| `compiler/grammar/minic.y` | the grammar and the AST-building actions, error recovery |
| `compiler/include/parallax/ast.hpp`, `src/ast.cpp` | the 26 node kinds, canonical form and hash used for grouping |
| `compiler/src/repair_engine.cpp`, `repair_stream.cpp` | candidate generation, validation, scoring, lanes, decision |
| `compiler/src/names.cpp` | static name checks (undeclared names, arity) |
| `compiler/src/serialize.cpp`, `json.cpp`, `main.cpp` | the JSON output and the `parallaxc` command line |
| `compiler/tests/` | 68 C++ unit tests |
| `backend/app/main.py` | HTTP endpoints, limits, stored results, serving the website |
| `backend/app/compiler.py` | safe execution of `parallaxc` (timeouts, concurrency) |
| `backend/app/astdiff.py` | node-by-node AST comparison |
| `frontend/src/features/workspace/` | the Workspace steps (`WorkspacePage`, `Diagnosis`, `Fixes`) |
| `frontend/src/features/ast/AstPage.tsx`, `components/AstOutline.tsx`, `ExprDiagram.tsx` | the AST Explorer |
| `frontend/src/features/research/ResearchPage.tsx` | Research & Method |
| `frontend/src/lib/explain.ts` | plain-language explanations, hints, clarification options |
| `frontend/src/lib/journey.ts` | input categories, ambiguity questions, cascade roles, option cards, verification |
| `frontend/src/lib/astModel.ts` | grammar rule per node, absorbed tokens, precedence notes, source → node |
| `frontend/src/app/ProjectContext.tsx` | shared state: source, results, undo history, chosen fix |
| `evaluation/` | dataset generator, experiment runner, metrics, baselines, stored results |
| `deliverables/` | presentations, script, report, paper |
