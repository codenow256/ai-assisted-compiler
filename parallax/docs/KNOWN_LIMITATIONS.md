# Known limitations

## Scope

- **Syntax only.** A recommended repair parses; it may still change meaning. MiniC has no type checker; only name, scope and arity warnings are used as evidence.
- **MiniC is a C subset.** There are no pointers, structs, strings, `switch`, `do-while`, compound assignment, `++/--`, casts or multi-dimensional arrays. C constructs are reported as `UNSUPPORTED_CONSTRUCT`.
- **Nesting depth.** The parser stack holds 5000 entries; roughly 2500 nested blocks or 5000 nested parentheses exceed it. Such input is reported as a resource limit (`UNSUPPORTED_CONSTRUCT`), never repaired and never a crash.
- **No code generation or execution.**

## Repair search

- **Bounded locality.** Edits are considered at most 3 tokens before the detection point (plus layout generators up to 60 tokens back). Causes further away are not found.
- **At most 2 edits per error site.** Errors that need 3 or more inserted tokens at one site (e.g. EOF inside `(1 +`) end in `NO_SAFE_REPAIR` (catalog S33/S34).
- **Cost-2 only when cost-1 fails.** If a single edit “works”, a better two-edit repair is not considered.
- **Placeholders.** Missing names and literals cannot be recovered; IntelliFix inserts `__hole`/`0` and lowers confidence.
- **Lane bounds.** 3 root hypotheses, 2 alternatives per step, depth 4, 12 leaves. Inputs with many errors may be truncated (reported).
- **Layout evidence assumes consistent indentation.** Code with inconsistent indentation weakens or misleads the `{`/`}` evidence.

## Confidence

- The margin is a **score difference, not a probability**; no calibration is claimed.
- τ = 1.5 was tuned on a small dev split and **did not fully transfer**: test selective risk was 12.0% against the 10% target.
- Typical confident errors: a deleted keyword (`while`), keyword typos and transpositions, where a cheap repair yields a different but valid program with no strong competitor. Two live examples from the professor-style suite: `whlie (i < 3) {` gets `insert ';'` (a call to an undeclared function `whlie`), and `(n > 0) {` with `while` deleted gets `insert ';'`. Both are RECOMMENDED and both change the meaning. Name-resolution warnings are evidence but are not weighted strongly enough to override this; changing the weights now would be tuning on test data.

## Evaluation

- **Synthetic mutations** of 30 programs by one author. They are not real student errors, and nothing is claimed about real students.
- AST equality is the correctness criterion. It is strict about operand order and literal spelling, and unattainable for content-lost cases.
- The CPCT+ comparison replays CPCT+'s first repair sequence through our adapter. CPCT+ breaks ties non-deterministically (replicates agree on 68.6–70.1% of cases; its top-1 varied from 47.4% to 49.1% across three runs). It optimises a different objective (recovery quality), which we did not measure.
- The follow-on stability evidence and AST grouping showed no or small measurable benefit on this benchmark.

## Engineering

- Tested natively on Linux (Chromium for E2E). The Windows build was cross-compiled with MinGW-w64 and tested under Wine (68/68 C++ tests, catalog output identical to Linux); it has **not** been run on a real Windows machine or built with MSVC. macOS is untested.
- The parser stack limit is fixed (5000 entries, about 90 KB of C stack per parse call).
- Bison's `yydebug` is a process-wide flag; tracing is safe in the single-request CLI process but would not be thread-safe inside a multi-threaded host.
- The draft persistence uses browser storage, which private browsing may disable.
- `/api/evaluate` runs synchronously in a worker thread; very large `limit` values are rejected (max 120).

## Future work

1. Collect consented real-world student errors and evaluate on them.
2. Learn the evidence weights with cross-validation over program families; calibrate to probabilities on a separate split.
3. Add type checking as evidence (e.g. `int x = true;`).
4. Combine a CPCT+-style complete minimum-cost search (larger edit distances) with IntelliFix's ranking and abstention.
5. Run a user study on whether explanations and abstention help learners.
6. Add CI on Linux, macOS and Windows, plus fuzzing of the lexer and parser.
