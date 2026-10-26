"""Captures REAL backend responses (FastAPI app in-process, real parallaxc) for
the Workspace UI tests (from parallax/):
    python3 frontend/tests/unit/fixtures/gen_workspace_fixtures.py

For every source: the /api/repair envelope (it contains lexer and parser
output too). Plus the /api/parse and /api/repair/compare responses the
ambiguity flow requests.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

c = TestClient(app)
RHS = "int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n"
RHS_FIXED = "int main() {\n  int price = 5;\n  int total = price + price ;\n  return total;\n}\n"
SOURCES = {
    "valid": "int square(int n) {\n  return n * n;\n}\n\nint main() {\n  int total = 0;\n  int i;\n  for (i = 0; i < 3; i = i + 1) {\n    total = total + square(i);\n  }\n  return total;\n}\n",
    "semicolon": "int main() {\n  int x = 1\n  return x;\n}\n",
    "semicolon_fixed": "int main() {\n  int x = 1;\n  return x;\n}\n",
    "missing_rhs": RHS,
    "missing_rhs_fixed": RHS_FIXED,
    "two_errors": "int main() {\n  int x = 1\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}\n",
    "empty": "",
    "whitespace": "   \n\n  \n",
    "comments_only": "// just a note\n/* nothing else */\n",
    "unterminated": "int main() {\n  int x = 1;\n  /* the comment never ends\n  return x;\n}\n",
    "unsupported": "int main() {\n  int i = 0;\n  i++;\n  return i;\n}\n",
    "invalid_char": "int main() {\n  int x = 1 @ 2;\n  return x;\n}\n",
    "missing_operator": "int main() {\n  int a = 1;\n  int b = 2;\n  int c = a b;\n  return c;\n}\n",
    "missing_name": "int main() {\n  int = 42;\n  return 0;\n}\n",
    "not_code": "hello world this is not code",
    "unfinished": "int main() {\n  int x = 1;\n",
    # reliability acceptance examples
    "accept_multi": "int main() {\n  int price = 5\n  int total = price + ;\n  total++;\n  return total\n}\n",
    "accept_rhs_pp": "int main() {\n  int price = 5;\n  int total = price + ;\n  total++;\n  return total;\n}\n",
    "accept_undeclared": "int main() {\n  int price = 5;\n  int total = price + 1;\n  total = tal + 1;\n  return total;\n}\n",
    "accept_pp_only": "int main() {\n  int price = 5;\n  int total = price + 1;\n  total++;\n  return total;\n}\n",
}
out = {"repair": {}, "parse": {}, "compare": {}}
for k, src in SOURCES.items():
    r = c.post("/api/repair", json={"source": src})
    assert r.status_code == 200, (k, r.text)
    out["repair"][k] = {"source": src, "envelope": r.json()}
out["parse"]["missing_rhs_fixed"] = c.post("/api/parse", json={"source": RHS_FIXED, "trace": False}).json()
out["compare"]["missing_rhs__fixed"] = c.post("/api/repair/compare", json={"before": RHS, "after": RHS_FIXED}).json()
plans = out["repair"]["missing_operator"]["envelope"]["data"]["repair"]["decision"]["plans"]
out["compare"]["plan0__plan1"] = c.post("/api/repair/compare", json={"before": plans[0]["source"], "after": plans[1]["source"]}).json()
path = Path(__file__).with_name("workspace_cases.json")
path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(len(out["repair"]), "sources,", path.stat().st_size // 1024, "KB")
