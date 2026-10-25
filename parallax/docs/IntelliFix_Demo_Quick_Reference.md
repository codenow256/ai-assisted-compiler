# IntelliFix — demo quick reference (print this page)

**Start:** `./scripts/run_backend.sh` (Linux) · `powershell -File scripts\windows\run_backend.ps1` (Windows) → http://127.0.0.1:8000 · the badge must say **Compiler 1.0.0**

| Button | Runs |
|---|---|
| Run lexer | tokens and lexical errors |
| Run parser | accept or reject, first error, LR state |
| Repair suggestions | candidates and decision |
| Full analysis (Ctrl+Enter) | all three |

## Samples and what they show (τ = 1.5)

| Sample | Status | Key fact |
|---|---|---|
| Valid program | No repair needed | AST with 32 nodes |
| Missing semicolon | Recommended | error at 4:3, fix on line 3; 60 candidates, 3 valid; margin 2.00 |
| Missing ')' | Recommended | `insert ')'`, margin 4.00 |
| Missing '{' | Multiple plausible | correct `insert '{'` ranked first, but margin 1.45 < 1.5 |
| Missing operand | Multiple plausible | margin 0.50 |
| Extra ')' | Multiple plausible | correct `delete ')'` ranked first, margin 1.00 |
| Two errors | Recommended | 2-step plan, margin 3.50 |
| Ambiguous operator | Multiple plausible | 20 operators tie, margin 0.00 |
| Missing variable name | Low confidence | placeholder `__hole` |
| Invalid character | Multiple plausible | lexical error `'@'` first; operators tie (margin 0.00) |
| Unsupported C construct | Unsupported construct | `i++` → “write x = x + 1” |

## Status meanings

| Status | Meaning |
|---|---|
| **Recommended** | one structural fix leads by at least τ = 1.5 |
| **Multiple plausible** | the margin is less than 1.5 |
| **Low confidence** | the plan invents a name or value, is incomplete, or drops code hidden in an unterminated comment |
| **No safe repair** | no bounded edit works |
| **Budget exhausted** | the search limit was hit |
| **Unsupported construct** | a C feature MiniC omits, or nesting too deep |
| **No repair needed** | the program is valid |

## Numbers (540 synthetic test cases)

| Measure | Value |
|---|---|
| Top-1 (restores the original program) | IntelliFix 71.5% [67.5, 75.1] · least-cost 55.2% · CPCT+ 47–49% |
| Wrong but confident (of all cases) | 6.1% (28.5% without abstention) |
| Coverage | 50.7% |
| Selective accuracy | 88.0% (risk 12.0%, target 10%) |
| Layout evidence | +8.9 points |
| Stability evidence | +0.2 points (no effect) |

## Say / don't say

| Say | Don't say |
|---|---|
| “parser-validated” | “correct” |
| “recommends about half the time” | “fixes errors automatically” |
| “synthetic mutations” | “student code” |
| “higher top-1 than CPCT+'s first repair on our benchmark” | “better than CPCT+” |
| “integrated and evaluated combination” | “novel algorithm” |

## If it breaks

| Symptom | Do |
|---|---|
| Compiler missing | build the compiler (Installation §3); never fake output |
| Backend not reachable | restart the backend, then refresh |
| “earlier text” | run again |
| A surprise | Live Evaluation Guide §5 |
