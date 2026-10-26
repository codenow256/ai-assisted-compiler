# IntelliFix

**IntelliFix: An Intelligent Compiler for Syntax Error Analysis, Detection, and Correction**

Technique: evidence-ranked multi-hypothesis syntax repair with confidence-aware abstention.

Team: Goutam Jayasingh (24BCE2417) · S Charumeena (24BCI0238) · Raguraman Govindasamy (24BDS0409)

> **Naming.** *IntelliFix* is the product name used in the interface and in all documents. The code keeps its original internal name *Parallax* in identifiers that other files depend on: the `parallax/` directory, the `parallaxc` binary, the C++ `parallax` namespace and `include/parallax/` headers, `PARALLAX_*` environment variables and browser-storage keys. Renaming those would break builds and scripts without changing anything users see.

IntelliFix is a syntax-error investigation workbench for **MiniC**, a small C-like teaching language. It has a Flex/Bison/C++ compiler, a bounded multi-candidate repair engine, a reproducible evaluation harness, a FastAPI backend and a React/TypeScript interface. When a program has a syntax error, IntelliFix:

1. generates alternative local repairs, using the parser's own expected-token sets and layout cues;
2. validates every candidate with the real parser, on reconstructed source that is re-lexed and re-parsed;
3. ranks candidates with an interpretable evidence score and shows every contribution;
4. groups candidates that produce the same abstract syntax tree (AST);
5. extends the best hypotheses to repair later errors and reports which follow-on diagnostics are stable across them;
6. recommends a repair only when the evidence clearly separates it from structurally different alternatives, and otherwise **abstains**, explaining why.

All outputs shown in the UI come from the real compiler. The evaluation numbers in this repository come from executed experiments (`evaluation/results/`).

> Branch: `feature/parallax-syntax-repair`. Everything lives in `parallax/`; files outside it are untouched.

---

## Headline results (held-out test split, 540 cases)

These are measured, not projected. Full tables: [`docs/RESULTS_AND_IMPACT.md`](docs/RESULTS_AND_IMPACT.md) and [`evaluation/results/report.md`](evaluation/results/report.md).

| System | Top-1 repair = reference AST | Wrong but confident (of all cases) | Coverage |
|---|---|---|---|
| IntelliFix (full), abstention at dev-tuned τ = 1.5 | **71.5%** [67.5, 75.1] | **6.1%** [4.4, 8.5] | 50.7% |
| IntelliFix, forced top-1 (no abstention) | 71.5% | 28.5% | 100% |
| Local least-cost repair (baseline C) | 55.2% [51.0, 59.3] | 44.6% | 99.8% |
| CPCT+ via grmtools `nimbleparse` (baseline G, 2 replicates) | ≈47–49% (varies between runs) | ≈51–53% | 100% |

Paired bootstrap, IntelliFix − least-cost top-1: **+16.3 points**, 95% CI [13.1, 19.4]. Results that did **not** improve are reported too. The follow-on stability evidence gives no measurable accuracy gain (+0.2 points, CI includes 0). Selective risk on test (12.0%) exceeds the 10% target that τ was tuned for on dev. The errors are **synthetic mutations**, not real student code.

---

## Repository layout

```
parallax/
  compiler/      Flex lexer, Bison grammar, C++ AST + repair engine, parallaxc CLI, C++ tests
  backend/       FastAPI app (app/), API tests (tests/)
  frontend/      React + TypeScript + Vite interface (Workspace, AST Explorer, Research & Method); vitest unit tests, Playwright E2E
  evaluation/    programs/ (30 valid programs), generators/, baselines/ (incl. CPCT+ adapter),
                 metrics/, experiments/, catalog/ (executable error catalog), dataset/, results/
  examples/      12 bundled demo programs + examples.json (descriptions, documented outcomes)
  docs/          20+ Markdown documents (see index below)
  scripts/       setup, build, test_all, run_backend, run_dev, run_evaluation
```

## Prerequisites

| Tool | Tested version | Needed for |
|---|---|---|
| C++17 compiler (g++/clang++) | g++ 13.3 | compiler |
| CMake | 3.28 (≥ 3.16) | compiler |
| GNU Bison | 3.8.2 (≥ 3.6 required: `parse.error custom`) | compiler |
| Flex | 2.6.4 | compiler |
| Python | 3.13 (≥ 3.10) | backend, evaluation |
| Node.js / npm | 22.x / 10.x | frontend |
| Rust + `nimbleparse` | nimbleparse 0.15.0 | **optional** CPCT+ baseline only |

No paid service, API key or network access is needed at run time.

## Run it on a fresh laptop

The website has three parts that must all be present: the **native compiler** `parallaxc` (C++, built with CMake, Flex and Bison), the **backend** (Python/FastAPI, which runs the compiler) and the **web interface** (built with Node.js; the backend serves it). If the compiler is not built, the site still opens but every analysis shows **“Compiler not built”** — that is the most common setup problem.

### Linux (Ubuntu/Debian) — tested

```bash
# 1. prerequisites (Node.js 18 or newer; on older Ubuntu install Node 22 from nodesource.com or with nvm)
sudo apt-get update
sudo apt-get install -y git g++ cmake bison flex python3 python3-pip python3-venv nodejs npm

# 2. get the code
git clone -b feature/parallax-syntax-repair https://github.com/codenow256/ai-assisted-compiler.git
cd ai-assisted-compiler/parallax

# 3. Python dependencies (a virtual environment avoids "externally managed environment" errors)
python3 -m venv .venv && . .venv/bin/activate
python3 -m pip install -r backend/requirements.txt

# 4. build the compiler and the web interface (cmake + make, npm ci + npm run build)
(cd frontend && npm ci)
./scripts/build.sh

# 5. start (keep this terminal open), then open http://127.0.0.1:8000
./scripts/run_backend.sh
```

Already have the repository? `cd ai-assisted-compiler && git fetch origin && git checkout feature/parallax-syntax-repair && git pull`, then steps 3–5.

### Windows 10/11 — scripts written, **not yet run on a real Windows machine**

The compiler code was cross-compiled for Windows with MinGW-w64 and passed all 68 C++ tests under Wine; the PowerShell scripts below and an MSVC build have not been executed. If a step fails, follow [`docs/INSTALLATION_AND_TROUBLESHOOTING.md` §3](docs/INSTALLATION_AND_TROUBLESHOOTING.md).

1. **Prerequisites** (PowerShell): `winget install Git.Git Python.Python.3.12 OpenJS.NodeJS.LTS MSYS2.MSYS2` (or install them from their websites).
2. **C++ toolchain** — open the **“MSYS2 UCRT64”** terminal and run:
   `pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja bison flex`
3. **PATH** — add `C:\msys64\ucrt64\bin` and `C:\msys64\usr\bin` to your user PATH (Settings → “Edit environment variables for your account”), then open a **new** PowerShell window.
4. **Get the code, build, start:**

```powershell
git clone -b feature/parallax-syntax-repair https://github.com/codenow256/ai-assisted-compiler.git
cd ai-assisted-compiler\parallax
powershell -ExecutionPolicy Bypass -File scripts\windows\check_environment.ps1   # lists anything missing
python -m pip install -r backend\requirements.txt
powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1               # builds compiler\build\parallaxc.exe and the UI
powershell -ExecutionPolicy Bypass -File scripts\windows\run_backend.ps1         # then open http://127.0.0.1:8000
```

Instead of MSYS2 you can use **Visual Studio Build Tools** with the **“Desktop development with C++”** workload plus `winget install WinFlexBison.win_flexbison`, and run `build.ps1` from the **“x64 Native Tools Command Prompt for VS”** (that prompt is what puts `cl.exe` on PATH). WSL2 with the Linux steps also works.

### Check that it works

1. The sidebar badge (bottom left) says **Compiler 1.0.0**, not “Compiler missing”.
2. **Workspace** → load the sample **Missing semicolon** → **Analyze**: step 2 (Diagnosis) says the parser stopped on line 4 and that line 3 is probably missing its `;`; step 3 (Fixes) recommends inserting it.
3. `http://127.0.0.1:8000/api/health` shows `"available": true`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| “Compiler not built” / `COMPILER_UNAVAILABLE` | build the compiler (step 4); on Windows check that `gcc --version` (MSYS2) or `cl` (Developer prompt) works in the same window |
| `Could NOT find BISON` / `FLEX` | install them (Linux: `apt-get install bison flex`; Windows: the MSYS2 `pacman` line or `win_flexbison`) and open a new terminal |
| `parse.error custom` error while building | Bison is older than 3.6 — install a newer one |
| `pip` says “externally managed environment” | use the virtual environment in step 3 |
| “Backend not reachable” in the browser | the backend terminal was closed or crashed — start it again |
| port 8000 is busy | Linux: `PORT=8001 ./scripts/run_backend.sh`; Windows: `$env:PORT=8001` before `run_backend.ps1`; open that port |
| `npm ci` fails | Node.js is older than 18, or a proxy blocks npm (`npm config set proxy …`) |

Development mode with hot reload: `./scripts/run_dev.sh` (API on :8000, Vite on <http://localhost:5173>). The interface has three destinations: **Workspace** (write → analyze → diagnosis → fixes → tree → apply & verify), **AST Explorer** and **Research & Method**; see [`docs/IntelliFix_UX_v2.md`](docs/IntelliFix_UX_v2.md).

### Use the compiler directly

```bash
./compiler/build/parallaxc lex     --file examples/02_missing_semicolon.mc
./compiler/build/parallaxc analyze --file examples/02_missing_semicolon.mc --trace
./compiler/build/parallaxc repair  --file examples/06_multiple_errors.mc
./compiler/build/parallaxc tree    < examples/01_valid_basic.mc
```

## Tests

```bash
./scripts/test_all.sh                       # every layer; prints PASS/FAIL/SKIPPED per layer
PARALLAX_E2E=1 ./scripts/test_all.sh        # also Playwright E2E (backend must run on :8000)
```

Layers (final run, see [`docs/TESTING.md`](docs/TESTING.md)): 68 C++ tests, 33 API tests, 161 evaluation tests (including 61 error-catalog and 88 professor-style cases, seeded fuzzing and HTTP sequences), 219 frontend unit tests (the Workspace journey for every input category, the AST model, explanations for all 88 professor-style inputs, all from real compiler responses) and 15 real-browser end-to-end journeys, all passing.

## Reproduce the evaluation

```bash
./scripts/run_evaluation.sh          # regenerates the dataset (seeded) and runs all systems (~1 min)
```

CPCT+ runs only if `nimbleparse` is installed (`cargo install nimbleparse`); otherwise the report says it was not run.

## Documentation index

| Document | Contents |
|---|---|
| [PROJECT_OVERVIEW](docs/PROJECT_OVERVIEW.md) | abstract, problem, objectives, scope, methodology, requirements |
| [RESEARCH_POSITIONING](docs/RESEARCH_POSITIONING.md) | related work (verified references), contribution, claims and non-claims |
| [MINIC_LANGUAGE_SPEC](docs/MINIC_LANGUAGE_SPEC.md) | the language |
| [LEXER_DESIGN](docs/LEXER_DESIGN.md) | tokens, positions, lexical errors |
| [GRAMMAR_AND_PARSER](docs/GRAMMAR_AND_PARSER.md) | grammar, precedence, LAC, recovery, diagnostics |
| [AST_AND_REPRESENTATIONS](docs/AST_AND_REPRESENTATIONS.md) | AST, ownership, canonical form, parse tree vs AST |
| [REPAIR_ALGORITHM](docs/REPAIR_ALGORITHM.md) | generation, validation, evidence, grouping, lanes, abstention, pseudocode |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | components and data flow |
| [API_CONTRACT](docs/API_CONTRACT.md) | endpoints, schemas, failure states |
| [EVALUATION_PROTOCOL](docs/EVALUATION_PROTOCOL.md) | dataset, splits, metrics, baselines, threats to validity |
| [RESULTS_AND_IMPACT](docs/RESULTS_AND_IMPACT.md) | measured results, including negative ones |
| [ERROR_CATALOG](docs/ERROR_CATALOG.md) / [observed results](docs/ERROR_CATALOG_RESULTS.md) | cases, expected and observed behaviour |
| [TESTING](docs/TESTING.md) | test layers, commands, outcomes |
| [INSTALLATION_AND_TROUBLESHOOTING](docs/INSTALLATION_AND_TROUBLESHOOTING.md) | setup on Linux, macOS, Windows (MSYS2, Visual Studio Build Tools or WSL2) |
| [DEMO_SCRIPT](docs/DEMO_SCRIPT.md) | timed live demonstration |
| [VIVA_PREPARATION](docs/VIVA_PREPARATION.md) | likely questions and defensible answers |
| [DECISION_LOG](docs/DECISION_LOG.md) | design decisions and reasons |
| [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md) | limits and future work |
| [CONTRIBUTION_AND_IMPACT](docs/CONTRIBUTION_AND_IMPACT.md) | feature-to-test and feature-to-evidence tables |
| [PRESENTATION_OUTLINE](docs/PRESENTATION_OUTLINE.md) | short talk outline |

**Project-submission material (IntelliFix_\*)**

| Document | Use it for |
|---|---|
| **Start here (beginners):** [Beginner guide](docs/INTELLIFIX_BEGINNER_GUIDE.md) · [Test matrix](docs/INTELLIFIX_TEST_MATRIX.md) · [Demo script](docs/INTELLIFIX_DEMO_SCRIPT.md) · [Viva guide](docs/INTELLIFIX_VIVA_GUIDE.md) | the whole project in simple English, page by page; 25 audited test cases with evidence; verified demo examples and a timed 9-minute demo; 27 viva questions with honest answers |
| [Interface v2: the repair journey](docs/IntelliFix_UX_v2.md) | three destinations, the five Workspace steps, features A–F status, every input category, old → new page mapping, tested professor demo |
| [Interactive and explanation features](docs/IntelliFix_Interactive_Features.md) | explanations for every input, ambiguity questions, hints, explained AST, before/after; clarification bound and proposed user study |
| [Capability matrix](docs/IntelliFix_Capability_Matrix.md) | what is implemented, partial, blocked or untested, with evidence |
| [Random-input test report](docs/IntelliFix_Random_Input_Test_Report.md) (generated) | 88 professor-style cases, 800 fuzz inputs, 7 HTTP sequences |
| [Live evaluation guide](docs/IntelliFix_Live_Evaluation_Guide.md) | handling an examiner's own input; decision tree |
| [Evaluation and reproducibility](docs/IntelliFix_Evaluation_and_Reproducibility.md) | audit of every headline number |
| [Research contribution and novelty](docs/IntelliFix_Research_Contribution_and_Novelty.md) | contribution-to-evidence table; claims to avoid |
| [Complete learning guide](docs/IntelliFix_Complete_Learning_Guide.md) · [From zero to advanced](docs/IntelliFix_From_Zero_to_Advanced_Guide.md) · [Glossary](docs/IntelliFix_Glossary.md) | learning the project |
| [End-to-end trace](docs/IntelliFix_End_to_End_Trace.md) · [Visual walkthrough](docs/IntelliFix_Visual_Walkthrough.md) | one real run, stage by stage; screenshots |
| [Viva question bank](docs/IntelliFix_Viva_Question_Bank.md) · [Mock viva](docs/IntelliFix_Mock_Viva.md) | viva preparation |
| [Demo script](docs/IntelliFix_Demo_Script.md) · [Quick reference](docs/IntelliFix_Demo_Quick_Reference.md) · [Presentation and live-demo guide](docs/IntelliFix_Presentation_and_Live_Demo_Guide.md) · [Team plan](docs/IntelliFix_Team_Presentation_Plan.md) | the presentation |

Editable deliverables (Word/PowerPoint) are in [`deliverables/`](deliverables); the final presentation is `IntelliFix_Final_Presentation.pptx` with `IntelliFix_Final_Presentation_Script.docx`.

## Limitations in one paragraph

IntelliFix validates **syntax only**: a parser-valid repair can still change meaning. MiniC is a subset of C. The benchmark uses synthetic mutations of 30 hand-written programs. The evidence weights were hand-set (on the dev split), and the decision margin is a score difference, **not a probability**. Repairs that need three or more tokens at one error site are outside the bounded search. See [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

## Troubleshooting (most common)

- **UI says “Backend offline”**: start `./scripts/run_backend.sh`.
- **“Compiler not built” (HTTP 503)**: run `cmake -S compiler -B compiler/build && cmake --build compiler/build`.
- **Bison error about `parse.error custom`**: Bison < 3.6. On macOS: `brew install bison` and put `$(brew --prefix bison)/bin` first on `PATH`.

## License

MIT for IntelliFix code (see [`LICENSE`](LICENSE)); third-party components are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
