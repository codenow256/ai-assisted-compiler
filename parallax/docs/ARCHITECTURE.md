# Architecture

## Components

```
┌──────────────────────────── Browser ─────────────────────────────┐
│ React + TypeScript (Vite)                                         │
│  Overview · Workbench · Lexer · Parser · AST · Repair lab ·       │
│  Hypotheses · Evaluation · Learning · Docs · Guided demo           │
│  ProjectContext: source, results (+ the source they belong to),   │
│  stale-request guard, accepted-repair history (undo)              │
└───────────────┬──────────────────────────────────────────────────┘
                │ JSON over HTTP (/api/*)
┌───────────────▼──────────────────────────────────────────────────┐
│ FastAPI backend (backend/app)                                     │
│  main.py      endpoints, error mapping, envelopes, static UI      │
│  compiler.py  async subprocess runner: argv only, stdin input,    │
│               timeout + kill, per-loop concurrency semaphore      │
│  grammar.py   parses Bison's parser.output (rules, LR states)     │
│  astdiff.py   canonical AST equality + structural diff            │
│  /api/evaluate → evaluation package (live mini-runs)              │
└───────────────┬──────────────────────────────────────────────────┘
                │ argv: parallaxc <mode> [options]; source on stdin; JSON on stdout
┌───────────────▼──────────────────────────────────────────────────┐
│ parallaxc (C++17, compiler/)                                      │
│  minic.l (Flex, re-entrant) → Token vector                        │
│  minic.y (Bison, pure, LAC, custom errors) → AST arena            │
│  names.cpp      scope/arity resolution (evidence only)            │
│  repair_stream  edits, origins, source reconstruction             │
│  repair_engine  generate · validate · score · group · lanes ·     │
│                 decide                                            │
│  serialize.cpp  deterministic JSON (schema_version 1)             │
└───────────────────────────────────────────────────────────────────┘

evaluation/ (Python, offline)
  generators → dataset/cases.jsonl → experiments (systems A–F, L, P; G via nimbleparse)
  → results/summary.json, report.md, per_case.jsonl → served by /api/evaluation/results
```

## Data flow of one “Analyze”

1. The UI sends three requests in parallel: `/api/lex`, `/api/parse` (with trace) and `/api/repair` (with the options). Each carries a sequence number; any earlier in-flight request of the same kind is aborted.
2. The backend validates the schema and the size, then launches `parallaxc` with an argument array. The source goes in on stdin; there are no temporary files or shell.
3. `parallaxc` lexes, parses and (for repair) runs the engine, then writes one JSON document.
4. The backend wraps it in an envelope `{run_id, kind, input_sha256, backend_ms, compiler_ms, data}`. For parse and repair it adds the LR state items from `parser.output` and the τ source.
5. The UI stores each result together with the exact source it was computed for. If the editor changes, every view shows a “stale result” banner and a re-run button.

## Module responsibilities

| Module | Responsibility | Tests |
|---|---|---|
| `compiler/grammar/minic.l` | tokens, spans, lexical errors | `test_lexer.cpp` |
| `compiler/grammar/minic.y` | grammar, AST construction, diagnostics, parser driver, `expected_at` | `test_parser.cpp` |
| `compiler/src/ast.cpp` | canonical form, hash, metrics, pretty tree | `test_parser.cpp` |
| `compiler/src/names.cpp` | name/arity warnings | `test_parser.cpp` |
| `compiler/src/repair_stream.cpp` | edits, origins, reconstruction | `test_repair.cpp` |
| `compiler/src/repair_engine.cpp` | repair pipeline | `test_repair.cpp`, error catalog |
| `compiler/src/serialize.cpp`, `main.cpp` | JSON contract, CLI | API tests |
| `backend/app/*` | HTTP API | `backend/tests/test_api.py` |
| `evaluation/*` | dataset, systems, metrics, reports, catalog | `evaluation/tests/*` |
| `frontend/src/*` | UI | `frontend/tests/unit/*`, `tests/e2e/run-e2e.mjs` |

## Concurrency and isolation

- The compiler is re-entrant (pure parser, per-call scanner state). The only global is Bison's `yydebug` flag, touched only when tracing; a thread test runs 32 threads × 50 parses.
- The backend runs at most 4 compiler processes at a time. Each request gets its own process, so a crash cannot affect another request.
- The UI applies only the newest response of each kind (tested in `app.test.tsx` “stale responses”).

## Deployment shapes

- **Single process:** `uvicorn app.main:app` serves `/api` and, if `frontend/dist` exists, the built UI.
- **Development:** Vite dev server on :5173 proxying `/api` to :8000.
- Nothing requires network access at run time.
