# IntelliFix — end-to-end trace of one real run

This follows one input from the editor to the screen. All values are real output, captured on 25 Oct 2026 from the running backend (`POST /api/repair`) and from `parallaxc repair`. Timings vary between machines and runs.

**Input** (`examples/02_missing_semicolon.mc`, 172 bytes, 11 lines; the `;` after `0` on line 3 is missing):

```c
// The declaration of `total` is missing its ';'.
int main() {
  int total = 0
  int i = 1;
  while (i <= 10) {
    total = total + i;
    i = i + 1;
  }
  return total;
}
```

## 0. The whole path at a glance

```
Browser (React)                     Backend (FastAPI, Python)                Compiler (parallaxc, C++)
───────────────                     ─────────────────────────                ─────────────────────────
Full analysis button
 └ ProjectContext.runAll()
    ├ runLex()    ─ POST /api/lex ───▶ check size ≤ 64 KB ─ subprocess ─────▶ parallaxc lex      (stdin = source)
    ├ runParse()  ─ POST /api/parse ──▶ … + LR state from parser.output ────▶ parallaxc analyze --trace
    └ runRepair() ─ POST /api/repair ─▶ … + --tau 1.5 (dev-selected) ──────▶ parallaxc repair --strategy parallax --tau 1.5
                                                                             lex → parse → localise → generate+validate
                                                                             → rank+group → lanes → decide → JSON on stdout
 ◀──── JSON envelope {run_id, kind, input_sha256, backend_ms, compiler_ms, data} ◀──── exit status 0 + JSON
RunSummary rows, status badge, diff, Accept repair
```

The three requests run **in parallel**, as three separate compiler processes (`Promise.all` in `ProjectContext.tsx`). Each row on the workbench therefore reports its own run. The backend never computes a result itself; it only passes data through and adds the LR-state description (`backend/app/main.py`, `compiler.py`).

## 1. Lexer (Flex) — `parallaxc lex`

38 tokens, 0 lexical errors, 1 comment (kept as trivia: `line`, offsets 0–49). The first tokens, as `kind lexeme line:col`:

```
INT int 2:1 · IDENT main 2:5 · LPAREN ( 2:9 · RPAREN ) 2:10 · LBRACE { 2:12 ·
INT int 3:3 · IDENT total 3:7 · ASSIGN = 3:13 · INT_LIT 0 3:15 ·
INT int 4:3 · IDENT i 4:7 · ASSIGN = 4:9 · INT_LIT 1 4:11 · SEMI ; 4:12 · WHILE while 5:3 · …
```

Token 8 (`0`) is directly followed by token 9 (`int`). Nothing in the token stream says anything is wrong: the lexer only splits text into tokens. Grammar is the parser's job.

## 2. Parser (Bison, LALR(1) with LAC) — `parallaxc analyze --trace`

```
first diagnostic : unexpected type-keyword 'int'   at 4:3 (token 9)   Bison: "unexpected int"
expected (LAC)   : + - * / % == != < <= > >= && || ; ,     (15 kinds)
LR state         : 47
state 47 items   : add_expr: mul_expr .        mul_expr: mul_expr . "*" unary   (and "/", "%")
```

The parser has read `int total = 0` and is in state 47, where `0` has been reduced to a `mul_expr`. In that state it can continue with an operator or end the declaration with `;` or `,`. `int` is none of these, so it **detects** the error at line 4. The programmer's mistake is at the **end of line 3**. That gap between where an error is detected and where it was made is the problem IntelliFix works on.

Panic-mode recovery reports one diagnostic in total, so there is no cascade here.

## 3. Repair engine — `parallaxc repair --tau 1.5`

### Stages (engine timings in ms, from this run)

| Stage | ms | What it reported |
|---|---|---|
| lex | 0.049 | 38 tokens, 0 lexical errors, 0 unsupported |
| parse | 0.134 | 1 diagnostic with panic-mode recovery |
| localise | 0.016 | first error at token 9, 15 expected kinds |
| generate-and-validate | 1.238 | 60 single-edit and 0 two-edit candidates; 3 accepted by the parser; 0 failed the source round trip |
| rank-and-group | 0.036 | 3 ranked candidates in 3 AST classes |
| hypothesis-lanes | 0.075 | 3 root hypotheses, 3 leaves |
| decide | 0.012 | RECOMMENDED |

Budget used: 73 parser invocations, out of at most 30,000 (2.6 ms of the 4,000 ms limit).

### Candidates

Positions 6–9 (the error token and the three before it) get every insert, delete and replace that LAC allows. That gives 60 candidates. Each one is applied to a copy of the token stream and parsed again:

| Outcome | Count | Meaning |
|---|---|---|
| valid | 3 | the whole program parses |
| same-location | 29 | the error stays at the same token |
| defers-error | 14 | the error moves, but by fewer than 3 tokens (e.g. `delete 'int'` moves it by 0 tokens) |
| earlier-error | 14 | the edit creates an earlier error |

### Evidence for the three valid candidates (score = Σ value × weight)

| Feature | `insert ';' at 3:16` | `replace 'int' with ','` | `replace 'int' with ';'` |
|---|---|---|---|
| edit_cost | 1 × −1.0 = **−1.00** | 1.5 × −1.0 = −1.50 | −1.50 |
| resolves_all_errors | +2.00 | +2.00 | +2.00 |
| deleted_content | 0 | 1 × −0.75 = −0.75 | −0.75 |
| line_end_semicolon | 1 × +0.75 = **+0.75** | 0 | 0 |
| name_warnings | 0 | 0 | 5 × −0.75 = **−3.75** |
| other 8 features | 0 | 0 | 0 |
| **score** | **1.75** | −0.25 | −4.00 |

`replace 'int' with ','` gives `int total = 0, i = 1;`, which is valid MiniC. It loses only because it overwrites a keyword the user wrote and does not sit at a line end. `replace 'int' with ';'` gives `; i = 1;` with `i` never declared, so name resolution adds 5 warnings.

### Grouping, lanes, decision

- Three different ASTs (hashes `86f8fd507e58a436`, `3b9bf362afc4f86e`, `f460dd82fbc85c01`), so three classes. Nothing merges.
- Each class is a root hypothesis; each already parses completely, so each lane ends in a valid leaf after one step.
- Margin = best class − second class = 1.75 − (−0.25) = **2.00**. The threshold τ = 1.5 was chosen on the dev split and is read by the backend from `evaluation/results/summary.json` (`tau_source: "dev-split selection"`).
- The plan has no placeholders, discards no multi-line error token, and 2.00 ≥ 1.5. Status **RECOMMENDED**, with these reasons: *“score margin 2.00 >= tau = 1.50”*, *“the plan yields a complete, parser-validated program”*.

### Source round trip

The recommended plan is turned back into text using the user's own spacing and comment:

```c
  int total = 0;
```

The rest of the file is unchanged. The text is lexed again; the token sequence must equal the edited stream exactly, and it is parsed again. Only then is the candidate called *parser-validated*.

## 4. Backend envelope (HTTP 200)

```json
{ "run_id": "2af603bf…", "kind": "repair", "api_version": "1.0.0",
  "input_sha256": "df37c1d0…", "backend_ms": 13.8, "compiler_ms": 7.1,
  "data": { "tokens": […], "parse": {…, "parser_state_info": {"number": 47, …}}, "repair": {…}, "tau_source": "dev-split selection" } }
```

`compiler_ms` is the process wall time, including start-up. `backend_ms` adds request handling.

## 5. What the user sees

Screenshot: [`images/walkthrough/05-workbench-full-analysis.png`](images/walkthrough/05-workbench-full-analysis.png).

- Lexer row: “current text · 38 tokens, 0 lexical error(s), 1 comment(s)”.
- Parser row: “rejected: unexpected type-keyword 'int' at 4:3 (1 diagnostic(s) with recovery)”, with `int` underlined on line 4.
- Repair row: “Recommended repair: 60 candidates, 3 parser-validated, 3 AST classes”.
- A green status panel with the two reasons, then a diff (`int total = 0` → `int total = 0;`) and **Accept repair**.

Accepting replaces the editor text with the plan's source. **Undo repair** restores the previous text.

## 6. What happens when something is missing

| Missing piece | Where it stops | What the user sees |
|---|---|---|
| compiler binary | `CompilerRunner.available()` | HTTP 503 `COMPILER_UNAVAILABLE`; every run row shows the code; banner “Compiler not built” with the build command ([`18-compiler-not-built.png`](images/walkthrough/18-compiler-not-built.png)) |
| backend | browser `fetch` fails | “Backend not reachable” |
| `summary.json` | `default_tau()` | τ = 1.0 is used, `tau_source: "default 1.0"` |
| `parser.output` | `attach_state` | no LR-state detail; everything else works |

## 7. Re-create this trace yourself

```bash
cd parallax
./compiler/build/parallaxc lex     < examples/02_missing_semicolon.mc
./compiler/build/parallaxc analyze --trace < examples/02_missing_semicolon.mc
./compiler/build/parallaxc repair --tau 1.5 < examples/02_missing_semicolon.mc | python3 -m json.tool | less
```

On Windows (PowerShell): `Get-Content examples\02_missing_semicolon.mc -Raw | .\compiler\build\parallaxc.exe repair --tau 1.5` (not executed on Windows by us).
