"""IntelliFix FastAPI application.

Run (from parallax/backend):  uvicorn app.main:app --port 8000
Every response that carries compiler output is produced by a real
invocation of parallaxc; when the compiler is unavailable the API says so
(HTTP 503) instead of returning placeholder data.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import astdiff, grammar
from .compiler import BUILD_HINT, CompilerError, CompilerRunner
from .config import PARALLAX_ROOT, get_settings
from .schemas import CompareRequest, EvaluateRequest, ParseRequest, RepairRequest, SourceRequest

API_VERSION = "1.0.0"
MAX_BODY_BYTES = 1024 * 1024

settings = get_settings()
runner = CompilerRunner(settings)
# FastAPI's interactive docs live under /api so they never shadow the UI's
# /docs route. (Swagger UI loads its assets from a CDN; it is an optional
# developer page and the only part that needs network access.)
app = FastAPI(title="IntelliFix API", version=API_VERSION,
              description="Evidence-ranked multi-hypothesis syntax repair for MiniC.",
              docs_url="/api/swagger", redoc_url=None, openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])


# ------------------------------------------------------------------ helpers
def envelope(kind: str, source: str | None, data: dict, started: float, compiler_ms: float | None = None) -> dict:
    return {
        "run_id": uuid.uuid4().hex,
        "kind": kind,
        "api_version": API_VERSION,
        "input_sha256": hashlib.sha256(source.encode("utf-8")).hexdigest() if source is not None else None,
        "backend_ms": round((time.perf_counter() - started) * 1000, 3),
        "compiler_ms": round(compiler_ms, 3) if compiler_ms is not None else None,
        "data": data,
    }


def error_response(status: int, code: str, message: str, hint: str | None = None, details=None) -> JSONResponse:
    body = {"run_id": uuid.uuid4().hex, "error": {"code": code, "message": message, "hint": hint}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(CompilerError)
async def compiler_error_handler(_: Request, exc: CompilerError):
    return error_response(exc.http_status, exc.code, exc.message, exc.hint)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    for e in errors:
        if e.get("type") == "string_too_long":
            return error_response(413, "INPUT_TOO_LARGE",
                                  f"Source exceeds {settings.max_input_bytes} characters.",
                                  "Split the program or shorten it.")
    if any(e.get("type") == "json_invalid" for e in errors):
        return error_response(422, "MALFORMED_JSON", "The request body is not valid JSON.")
    details = [{"loc": [str(x) for x in e.get("loc", [])], "msg": e.get("msg"), "type": e.get("type")}
               for e in errors]
    return error_response(422, "INVALID_REQUEST", "The request does not match the API schema.", details=details)


@app.exception_handler(Exception)
async def unexpected_handler(_: Request, exc: Exception):  # pragma: no cover - defensive
    return error_response(500, "BACKEND_FAILURE", "Unexpected backend error.", type(exc).__name__)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return error_response(413, "INPUT_TOO_LARGE", "Request body too large.")
    return await call_next(request)


def check_bytes(source: str) -> None:
    if len(source.encode("utf-8")) > settings.max_input_bytes:
        from .compiler import InputTooLarge
        raise InputTooLarge(f"Input exceeds {settings.max_input_bytes} bytes after UTF-8 encoding.")


def attach_state(doc: dict, state: int | None) -> None:
    report = grammar.load_report(settings.parser_report)
    doc["parser_state_info"] = grammar.state_info(report, state)
    doc["grammar_report_available"] = report is not None


# ------------------------------------------------------------------ meta
@app.get("/api/health")
async def health():
    available = runner.available()
    version = await runner.version() if available else None
    return {
        "status": "ok" if available and version else "degraded",
        "api_version": API_VERSION,
        "compiler": {"available": bool(available and version), "binary": runner.binary().name,
                     "version": version.get("version") if version else None},
        "hint": None if available else BUILD_HINT,
    }


@app.get("/api/capabilities")
async def capabilities():
    version = await runner.version() if runner.available() else None
    cpct = await run_in_threadpool(_cpct_status)
    return {
        "api_version": API_VERSION,
        "compiler_available": version is not None,
        "compiler_version": version.get("version") if version else None,
        "limits": {"max_input_bytes": settings.max_input_bytes, "timeout_s": settings.timeout_s,
                   "max_concurrency": settings.max_concurrency, "max_nesting": 5000},
        "modes": ["lex", "parse", "analyze", "repair", "compare", "evaluate"],
        "repair_options": {"strategy": ["parallax", "least-cost"], "toggles": ["grouping", "stability",
                                                                                "abstention", "layout"]},
        "grammar_report_available": settings.parser_report.is_file(),
        "evaluation_results_available": (settings.results_dir / "summary.json").is_file(),
        "optional_baselines": {"cpctplus": cpct},
    }


def _cpct_status() -> dict:
    sys.path.insert(0, str(PARALLAX_ROOT))
    try:
        from evaluation.baselines.cpctplus_adapter import availability
        return availability()
    except Exception as exc:  # noqa: BLE001 - optional component
        return {"available": False, "reason": f"adapter not loadable ({type(exc).__name__})"}


@app.get("/api/examples")
async def examples():
    manifest = json.loads((settings.examples_dir / "examples.json").read_text(encoding="utf-8"))
    out = []
    for item in manifest:
        path = settings.examples_dir / f"{item['id']}.mc"
        if path.is_file():
            out.append({**item, "source": path.read_text(encoding="utf-8")})
    return {"examples": out, "note": "Bundled sample programs; all outputs are computed live by the compiler."}


# ------------------------------------------------------------------ compiler
@app.post("/api/lex")
async def lex(req: SourceRequest):
    started = time.perf_counter()
    check_bytes(req.source)
    res = await runner.run("lex", req.source)
    return envelope("lex", req.source, res.doc, started, res.wall_ms)


@app.post("/api/parse")
async def parse(req: ParseRequest):
    started = time.perf_counter()
    check_bytes(req.source)
    res = await runner.run("analyze", req.source, ["--trace"] if req.trace else [])
    diags = res.doc["parse"]["diagnostics"]
    attach_state(res.doc, diags[0]["parser_state"] if diags else None)
    return envelope("parse", req.source, res.doc, started, res.wall_ms)


@app.post("/api/analyze")
async def analyze(req: SourceRequest):
    started = time.perf_counter()
    check_bytes(req.source)
    res = await runner.run("analyze", req.source)
    diags = res.doc["parse"]["diagnostics"]
    attach_state(res.doc, diags[0]["parser_state"] if diags else None)
    return envelope("analyze", req.source, res.doc, started, res.wall_ms)


def repair_args(o) -> list[str]:
    args = ["--strategy", o.strategy]
    if not o.grouping:
        args.append("--no-grouping")
    if not o.stability:
        args.append("--no-stability")
    if not o.abstention:
        args.append("--no-abstention")
    if not o.layout:
        args.append("--no-layout")
    tau = o.tau if o.tau is not None else default_tau()
    args += ["--tau", repr(float(tau))]
    if o.max_parses is not None:
        args += ["--max-parses", str(o.max_parses)]
    if o.max_depth is not None:
        args += ["--max-depth", str(o.max_depth)]
    return args


def default_tau() -> float:
    """tau selected on the dev split by the last evaluation run (else 1.0)."""
    path = settings.results_dir / "summary.json"
    try:
        return float(json.loads(path.read_text())["tau_selection"]["tau"])
    except (OSError, KeyError, ValueError, TypeError):
        return 1.0


@app.post("/api/repair")
async def repair(req: RepairRequest):
    started = time.perf_counter()
    check_bytes(req.source)
    res = await runner.run("repair", req.source, repair_args(req.options))
    site = res.doc["repair"]["error_site"]
    attach_state(res.doc, site.get("parser_state") if site else None)
    res.doc["tau_source"] = "request" if req.options.tau is not None else (
        "dev-split selection" if (settings.results_dir / "summary.json").is_file() else "default 1.0")
    return envelope("repair", req.source, res.doc, started, res.wall_ms)


@app.post("/api/repair/compare")
async def compare(req: CompareRequest):
    started = time.perf_counter()
    check_bytes(req.before)
    check_bytes(req.after)
    a, b = await asyncio.gather(runner.run("analyze", req.before), runner.run("analyze", req.after))
    pa, pb = a.doc["parse"], b.doc["parse"]

    def side(p):
        return {"ok": p["ok"], "ast": p["ast"], "ast_hash": p.get("ast_hash"),
                "diagnostics": [d["message"] for d in p["diagnostics"]]}

    both = pa["ok"] and pb["ok"]
    data = {
        "before": side(pa),
        "after": side(pb),
        "comparable": both,
        "equivalent": both and astdiff.canonical(pa["ast"]) == astdiff.canonical(pb["ast"]),
        "changes": astdiff.diff(pa["ast"], pb["ast"]) if both else [],
        "rule": "Equivalent means identical canonical AST (node kinds, attributes, child order); "
                "spans, whitespace, comments and redundant parentheses are ignored.",
    }
    return envelope("compare", req.before + "\0" + req.after, data, started, a.wall_ms + b.wall_ms)


# ------------------------------------------------------------------ grammar
@app.get("/api/grammar")
async def grammar_info():
    report = grammar.load_report(settings.parser_report)
    return {
        "grammar_source": grammar.grammar_rules_section(settings.grammar_file),
        "lexer_source": grammar.grammar_rules_section(settings.lexer_file),
        "rules": report["rules"] if report else [],
        "states": len(report["states"]) if report else None,
        "report_available": report is not None,
        "note": "Rules and LR states are read from Bison's own report (parser.output) generated at build time.",
    }


@app.get("/api/grammar/state/{number}")
async def grammar_state(number: int):
    info = grammar.state_info(grammar.load_report(settings.parser_report), number)
    if info is None:
        return error_response(404, "STATE_NOT_FOUND", f"No LR state {number} in the parser report.")
    return info


# ------------------------------------------------------------------ docs
DOCS_DIR = PARALLAX_ROOT / "docs"
DOC_NAME = re.compile(r"^[A-Za-z0-9_]+$")
DOC_IMAGE = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.(png|jpg|jpeg|svg)$")
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml"}


@app.get("/api/docs")
async def docs_index():
    files = sorted(DOCS_DIR.glob("*.md")) if DOCS_DIR.is_dir() else []
    out = [{"name": "README", "title": "README"}] if (PARALLAX_ROOT / "README.md").is_file() else []
    for f in files:
        first = f.read_text(encoding="utf-8").splitlines()[:1]
        out.append({"name": f.stem, "title": first[0].lstrip("# ").strip() if first else f.stem})
    return {"docs": out}


@app.get("/api/docs/images/{path:path}")
async def doc_image(path: str):
    """Images referenced by the Markdown docs (docs/images/…); nothing else is served."""
    root = (DOCS_DIR / "images").resolve()
    if not DOC_IMAGE.match(path):
        return error_response(400, "INVALID_IMAGE_PATH", "Malformed image path.")
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        return error_response(404, "IMAGE_NOT_FOUND", f"No image {path}.")
    return FileResponse(target, media_type=IMAGE_TYPES[target.suffix.lstrip(".").lower()])


@app.get("/api/docs/{name}")
async def doc(name: str):
    if not DOC_NAME.match(name):
        return error_response(400, "INVALID_DOC_NAME", "Malformed document name.")
    path = PARALLAX_ROOT / "README.md" if name == "README" else DOCS_DIR / f"{name}.md"
    if not path.is_file():
        return error_response(404, "DOC_NOT_FOUND", f"No document {name}.")
    return {"name": name, "markdown": path.read_text(encoding="utf-8")}


# ------------------------------------------------------------------ evaluation
@app.get("/api/evaluation/results")
async def evaluation_results():
    path = settings.results_dir / "summary.json"
    if not path.is_file():
        return error_response(404, "RESULTS_NOT_FOUND", "No stored evaluation results.",
                              "Run: python -m evaluation.experiments.run_experiments")
    summary = json.loads(path.read_text(encoding="utf-8"))
    report = settings.results_dir / "report.md"
    clar = settings.results_dir / "clarification_bound.json"
    return {
        "summary": summary,
        "clarification": json.loads(clar.read_text(encoding="utf-8")) if clar.is_file() else None,
        "report_markdown": report.read_text(encoding="utf-8") if report.is_file() else None,
        "provenance": {"file": "evaluation/results/summary.json",
                       "generated_utc": summary.get("environment", {}).get("timestamp_utc"),
                       "git_commit": summary.get("environment", {}).get("git_commit"),
                       "kind": "stored results of a full experiment run"},
    }


CASE_ID = re.compile(r"^[a-z0-9_]+-\d{3}$")


@app.get("/api/evaluation/case/{case_id}")
async def evaluation_case(case_id: str):
    if not CASE_ID.match(case_id):
        return error_response(400, "INVALID_CASE_ID", "Malformed case id.")
    path = PARALLAX_ROOT / "evaluation" / "dataset" / "cases.jsonl"
    if not path.is_file():
        return error_response(404, "DATASET_NOT_FOUND", "Dataset not generated.")
    with open(path, encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            if c["id"] == case_id:
                return {k: c[k] for k in ("id", "family", "split", "category", "ambiguity", "edits", "original",
                                          "corrupted", "n_errors")}
    return error_response(404, "CASE_NOT_FOUND", f"No case {case_id}.")


def _live_evaluation(req: EvaluateRequest, tau: float) -> dict:
    sys.path.insert(0, str(PARALLAX_ROOT))
    from evaluation.baselines.systems import BY_ID
    from evaluation.experiments import run_experiments as rx

    path = PARALLAX_ROOT / "evaluation" / "dataset" / "cases.jsonl"
    cases = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    pool = [c for c in cases if c["split"] == req.split]
    sample = random.Random(req.seed).sample(pool, min(req.limit, len(pool)))
    systems = [BY_ID[s] for s in ("A", "C", "F", "P")]
    started = time.perf_counter()
    rows = [rx.run_case(c, systems) for c in sample]
    metrics = rx.evaluate_split(sample, rows, tau, systems=[BY_ID["C"], BY_ID["F"], BY_ID["P"]])
    for sid in ("C", "F", "P"):
        metrics[sid].pop("risk_coverage", None)
    return {"kind": "live evaluation", "split": req.split, "n": len(sample), "seed": req.seed, "tau": tau,
            "systems": [{"id": s["id"], "name": s["name"]} for s in systems],
            "metrics": metrics, "seconds": time.perf_counter() - started,
            "case_ids": [c["id"] for c in sample]}


@app.post("/api/evaluate")
async def evaluate(req: EvaluateRequest):
    if not runner.available():
        from .compiler import BUILD_HINT, CompilerUnavailable
        raise CompilerUnavailable("The parallaxc compiler binary was not found.", BUILD_HINT)
    if not (PARALLAX_ROOT / "evaluation" / "dataset" / "cases.jsonl").is_file():
        return error_response(404, "DATASET_NOT_FOUND", "Dataset not generated.",
                              "Run: python -m evaluation.generators.generate_dataset")
    started = time.perf_counter()
    data = await run_in_threadpool(_live_evaluation, req, default_tau())
    return envelope("evaluate", None, data, started)


# ------------------------------------------------------------------ static UI
DIST = PARALLAX_ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return error_response(404, "NOT_FOUND", f"No API route /{path}.")
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
