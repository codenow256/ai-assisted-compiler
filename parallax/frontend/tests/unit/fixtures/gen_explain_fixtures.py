"""Captures REAL compiler responses for the explanation tests.

Runs `parallaxc repair --tau 1.5` (the UI's threshold) on every professor-style
case plus a few extra inputs and keeps only the fields the explanation code
reads. Re-run after compiler changes (from parallax/):
    python3 frontend/tests/unit/fixtures/gen_explain_fixtures.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
from evaluation.lib import compiler  # noqa: E402
from evaluation.professor.cases import CASES  # noqa: E402

EXTRA = {
    "X01_missing_rhs": "int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n",
    "X02_eof_in_block": "int main() {\n  int x = 1;\n",
    "X03_two_errors": "int main() {\n  int x = 1\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}\n",
}


def slim(doc: dict, src: str) -> dict:
    toks = [{k: t[k] for k in ("index", "kind", "category", "lexeme", "start", "end")} for t in doc["tokens"]]
    truncated = len(toks) > 3000
    if truncated:
        toks = toks[:200]
    r = doc["repair"]
    plans = [{k: p[k] for k in ("leaf", "valid", "total_cost", "summary", "source", "edits")} for p in r["decision"]["plans"]]
    for p in plans:
        if len(p["source"]) > 4000:
            p["source"] = p["source"][:4000]
    parse = {k: doc["parse"].get(k) for k in ("ok", "diagnostics", "resource_limit", "ast_nodes", "name_warnings")}
    parse["diagnostics"] = parse["diagnostics"][:20]
    parse["ast"] = doc["parse"]["ast"] if doc["parse"].get("ast") and len(src) < 4000 else None
    if doc["parse"].get("ast") and parse["ast"] is None:
        parse["ast"] = {"kind": "Program", "children": [], "span": doc["parse"]["ast"]["span"]}
        parse["_ast_dropped"] = True
    return {
        "tokens": toks, "_tokens_truncated": truncated, "lexical_errors": doc["lexical_errors"][:20], "parse": parse,
        "repair": {"decision": {**{k: r["decision"][k] for k in ("status", "summary", "reasons", "margin", "tau")}, "plans": plans},
                   "hypotheses": {"stability": r["hypotheses"]["stability"], "truncated": r["hypotheses"]["truncated"], "leaves": []}},
    }


out = {}
items = [(c["id"], c["src"], c["title"]) for c in CASES] + [(k, v, k) for k, v in EXTRA.items()]
for cid, src, title in items:
    doc = compiler.run("repair", src, ["--tau", "1.5"], timeout=60)
    out[cid] = {"title": title, "source": src if len(src) < 4000 else src[:4000], "_source_truncated": len(src) >= 4000, "doc": slim(doc, src)}
path = Path(__file__).with_name("explain_cases.json")
path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(len(out), "cases,", path.stat().st_size // 1024, "KB")
