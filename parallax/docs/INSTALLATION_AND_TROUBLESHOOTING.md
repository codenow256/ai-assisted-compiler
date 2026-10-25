# Installation and troubleshooting

## 1. Linux (Ubuntu/Debian; the tested platform)

```bash
sudo apt-get update
sudo apt-get install -y g++ cmake bison flex python3 python3-pip nodejs npm
# Node ≥ 18 is required; if your distribution ships an older one, install Node 22 via nvm or NodeSource.

git clone <repo> && cd <repo>
git checkout feature/parallax-syntax-repair
cd parallax
./scripts/setup.sh          # pip install, npm ci, cmake build, vite build
./scripts/run_backend.sh    # http://127.0.0.1:8000
```

Use a virtual environment if your system Python is externally managed:
`python3 -m venv .venv && . .venv/bin/activate && pip install -r backend/requirements.txt`.

## 2. macOS

```bash
xcode-select --install
brew install cmake bison flex python node
export PATH="$(brew --prefix bison)/bin:$(brew --prefix flex)/bin:$PATH"   # Apple's bison is 2.3 — too old
cd parallax && ./scripts/setup.sh
```

Not tested by the authors (see TESTING.md); the code uses only portable C++17 and POSIX.

## 3. Windows (native)

### Why the UI says “Compiler not built”

The web UI and FastAPI backend are Python and JavaScript, so they run on Windows without a C++ compiler. The **native compiler** `parallaxc.exe` (Flex lexer + Bison parser + C++ repair engine) does not exist until CMake builds it. Every lexer, parser and repair button calls that executable. Until it exists, the API correctly answers HTTP 503 `COMPILER_UNAVAILABLE`, and the UI shows “Compiler not built” instead of fake output.

Your earlier attempt failed because CMake was installed but **no C++ compiler was visible**. `cl.exe` (MSVC) is only on `PATH` inside a *Developer* prompt, and only if the **“Desktop development with C++”** workload is installed. Visual Studio Build Tools without that workload has no `cl.exe` at all, which matches the missing `VC\Tools\MSVC\…` directory you saw.

Check what is installed: `powershell -ExecutionPolicy Bypass -File scripts\windows\check_environment.ps1`.

### Option A — MSYS2 / MinGW-w64 (recommended: free, small, no Visual Studio)

1. Install MSYS2 from <https://www.msys2.org> (default folder `C:\msys64`).
2. Open **“MSYS2 UCRT64”** and run:
   `pacman -S --needed mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja bison flex`
3. Add `C:\msys64\ucrt64\bin` and `C:\msys64\usr\bin` to your user `PATH`, then open a new PowerShell.
4. From the `parallax` folder: `powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1`.
   This configures with Ninja and builds `compiler\build\parallaxc.exe`. The MinGW runtime is linked statically (see `compiler/CMakeLists.txt`), so the backend can launch it from any shell.

### Option B — Visual Studio Build Tools (MSVC)

1. In the **Visual Studio Installer**, modify *Build Tools* and tick **“Desktop development with C++”** (it includes MSVC, the Windows SDK and “C++ CMake tools”).
2. Install Bison/Flex for Windows: `winget install WinFlexBison.win_flexbison` (provides `win_bison` and `win_flex`; CMake's FindBISON/FindFLEX look for these names).
3. Open **“x64 Native Tools Command Prompt for VS”**. This is what puts `cl.exe` on `PATH`; check with `where cl`.
4. From `parallax`: `powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1`
   (or manually: `cmake -S compiler -B compiler\build` then `cmake --build compiler\build --config Release`). The binary lands in `compiler\build\Release\parallaxc.exe`, which the backend finds automatically.

### Option C — WSL2

Install Ubuntu under WSL2 and follow the Linux instructions inside it.

### After building

```powershell
python -m pip install -r backend\requirements.txt
cd frontend; npm ci; npm run build; cd ..
powershell -File scripts\windows\run_backend.ps1      # http://127.0.0.1:8000
```

The sidebar badge should change from “Compiler missing” to “Compiler 1.0.0”. Check with `curl http://127.0.0.1:8000/api/health`: `"compiler":{"available":true,...}`.

### What has been verified for Windows (and what has not)

| Check | Result |
|---|---|
| Cross-compiling with MinGW-w64 (`compiler/cmake/mingw-w64-x86_64.cmake`) | **passed**: `parallaxc.exe` and `parallax_tests.exe` build with no warnings; they import only `KERNEL32.dll` and `msvcrt.dll` |
| Running the Windows binaries under **Wine 9.0** | **passed**: 66/66 C++ tests; 61/61 error-catalog cases with output identical to the Linux build; CRLF input keeps exact byte offsets |
| Building with MSVC (`cl.exe`) | **not executed**: no MSVC in the test environment. The code avoids POSIX-only headers (`%option nounistd`, `<filesystem>` instead of `dirent.h`), and CMake adds `/utf-8 /EHsc` for MSVC |
| Running on a real Windows machine | **not executed** by us. Please run `scripts\windows\test_all.ps1` after building |
| PowerShell scripts | written; **not executed** (no PowerShell in the test environment) |

Windows-specific code changes: the compiler switches stdin/stdout to binary mode (`_setmode`), so CRLF bytes are not translated and byte offsets stay exact. The backend finds `parallaxc.exe` in `build\` or `build\Release\` (`app/config.py::locate_compiler`) and runs it with `subprocess.run` in a worker thread, which works on every Windows event loop.

## 4. Optional: CPCT+ baseline

```bash
curl https://sh.rustup.rs -sSf | sh       # or your distribution's rustup/cargo
cargo install nimbleparse                 # tested: nimbleparse 0.15.0
export PATH="$HOME/.cargo/bin:$PATH"
./scripts/run_evaluation.sh               # now includes system G
```

Without it, everything else works. The capabilities endpoint and the evaluation report state that CPCT+ was not run, and why.

## 5. Manual build steps

```bash
cmake -S compiler -B compiler/build -DCMAKE_BUILD_TYPE=Release
cmake --build compiler/build -j
ctest --test-dir compiler/build
(cd frontend && npm ci && npm run build)
```

## 6. Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PARALLAX_COMPILER` | `compiler/build/parallaxc` | compiler binary used by the backend |
| `PARALLAX_PARSER_REPORT` | `compiler/build/parser.output` | Bison report for LR state views |
| `PARALLAX_RESULTS` | `evaluation/results` | stored evaluation results |
| `PARALLAX_TIMEOUT_S` | 15 | per-call compiler timeout |
| `PARALLAX_MAX_CONCURRENCY` | 4 | concurrent compiler processes |
| `PARALLAX_CORS` | localhost dev origins | allowed browser origins |
| `PARALLAXC` | as above | binary used by the evaluation scripts |
| `PARALLAX_API` | `http://127.0.0.1:8000` | Vite dev-proxy target |
| `PARALLAX_URL` | `http://localhost:8000` | E2E target |

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `minic.y: error: %define variable 'parse.error' requires keyword values` or `unrecognized: custom` | Bison < 3.6 | install Bison ≥ 3.6 (macOS: Homebrew; put it first on `PATH`) |
| `Could NOT find BISON (missing: BISON_EXECUTABLE)` / `FLEX` | not installed or not on `PATH` | install; `cmake -DBISON_EXECUTABLE=/path/to/bison …` |
| `conflicts: … expected 0` at build | someone edited the grammar | resolve the conflict; `bison -Wcounterexamples` shows examples |
| UI: “Backend not reachable” | API not running / wrong port | `./scripts/run_backend.sh`; in dev, check the Vite proxy target |
| HTTP 503 `COMPILER_UNAVAILABLE` | binary not built or not executable | build the compiler; check `PARALLAX_COMPILER` |
| HTTP 504 `COMPILER_TIMEOUT` | very large or pathological input | smaller input; raise `PARALLAX_TIMEOUT_S` |
| Parser view: “Bison's report was not found” | `parser.output` missing | rebuild with CMake (it generates the report) |
| Evaluation page: “No stored evaluation results” | `summary.json` missing | `./scripts/run_evaluation.sh` |
| `npm ci` fails behind a proxy | npm proxy settings | `npm config set proxy …` / `https-proxy …` |
| `pip` refuses (PEP 668 “externally managed”) | system Python | use a virtual environment |
| `ModuleNotFoundError: evaluation` | wrong working directory | run `python -m evaluation…` from `parallax/` |
| Playwright cannot find a browser | a different Playwright version was installed | use the preinstalled one or `npx playwright install chromium` |
| Port 8000 busy | another server | `PORT=8001 ./scripts/run_backend.sh` and `PARALLAX_API=http://127.0.0.1:8001 npm run dev` |
