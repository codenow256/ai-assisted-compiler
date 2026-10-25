"""Captures REAL compiler ASTs for the AST explorer tests (from parallax/):
    python3 frontend/tests/unit/fixtures/gen_ast_fixtures.py

Each entry holds the source, the `analyze` parse section (AST or partial
recovered tree), and for invalid code the repair plans with their ASTs. The
structural comparison is computed by the backend's own astdiff module.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))
from evaluation.lib import compiler  # noqa: E402
from app import astdiff  # noqa: E402

PROGRAMS = {
    "precedence": "int f(int a, int b, int c) {\n  return a + b * c;\n}\n",
    "parens": "int f(int a, int b, int c) {\n  return (a + b) * c;\n}\n",
    "left_assoc": "int f(int a, int b, int c) {\n  return a - b - c;\n}\n",
    "control": "int square(int n) {\n  return n * n;\n}\n\nint main() {\n  int total = 0;\n  int i;\n  for (i = 0; i < 3; i = i + 1) {\n    if (total > 10) break;\n    total = total + square(i);\n  }\n  return total;\n}\n",
    "partial": "int main() {\n  int a = 1;\n  int b = (a + 2;\n  return b;\n}\n",
    "ambiguous": "int main() {\n  int a = 1;\n  int b = 2;\n  int c = a b;\n  return c;\n}\n",
}

out = {}
for name, src in PROGRAMS.items():
    doc = compiler.run("repair", src, ["--tau", "1.5"], timeout=60)
    p = doc["parse"]
    entry = {"source": src, "parse": {k: p.get(k) for k in ("ok", "ast", "recovered_ast", "diagnostics", "ast_nodes")},
             "tokens": [{k: t[k] for k in ("index", "kind", "category", "lexeme", "start", "end")} for t in doc["tokens"]]}
    plans = doc["repair"]["decision"]["plans"]
    entry["plans"] = [{k: pl.get(k) for k in ("summary", "source", "edits", "valid")} for pl in plans[:3]]
    for pl in entry["plans"]:  # the AST of each repaired program, as the backend attaches it
        pl["ast"] = compiler.run("analyze", pl["source"], [], timeout=60)["parse"]["ast"]
    plans = entry["plans"]
    if len(plans) >= 2 and plans[0].get("ast") and plans[1].get("ast"):
        entry["compare_plan0_plan1"] = astdiff.diff(plans[0]["ast"], plans[1]["ast"])
    out[name] = entry
path = Path(__file__).with_name("ast_cases.json")
path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(len(out), "programs,", path.stat().st_size // 1024, "KB")
