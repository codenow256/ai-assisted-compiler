"""API tests. These call the REAL compiler binary (built by CMake); tests that
need it are skipped with a clear reason if it has not been built."""
from __future__ import annotations

import json
import os
import stat
import sys
import textwrap
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as appmain
from app.compiler import CompilerRunner
from app.config import PARALLAX_ROOT, Settings

needs_compiler = pytest.mark.skipif(not appmain.runner.available(), reason="parallaxc not built")


@pytest.fixture()
def client():
    return TestClient(appmain.app)


def ok_data(resp):
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "run_id" in body and "data" in body
    return body["data"]


# ------------------------------------------------------------------ meta
@needs_compiler
def test_health_reports_compiler(client):
    r = client.get("/api/health").json()
    assert r["status"] == "ok"
    assert r["compiler"]["available"] is True
    assert r["compiler"]["binary"] in ("parallaxc", "parallaxc.exe")  # no absolute paths leak


@needs_compiler
def test_capabilities(client):
    r = client.get("/api/capabilities").json()
    assert r["compiler_available"] is True
    assert r["limits"]["max_input_bytes"] == 65536
    assert "cpctplus" in r["optional_baselines"]
    assert isinstance(r["optional_baselines"]["cpctplus"]["available"], bool)


def test_examples_are_real_files(client):
    ex = client.get("/api/examples").json()["examples"]
    assert len(ex) >= 9
    for e in ex:
        assert (PARALLAX_ROOT / "examples" / f"{e['id']}.mc").read_text() == e["source"]


@needs_compiler
def test_examples_match_documented_status(client):
    for e in client.get("/api/examples").json()["examples"]:
        d = ok_data(client.post("/api/repair", json={"source": e["source"]}))
        assert d["repair"]["decision"]["status"] == e["expected_status"], e["id"]


# ------------------------------------------------------------------ compiler endpoints
@needs_compiler
def test_lex_tokens_and_positions(client):
    d = ok_data(client.post("/api/lex", json={"source": "int x;\nx = 1;"}))
    kinds = [t["kind"] for t in d["tokens"]]
    assert kinds == ["INT", "IDENT", "SEMI", "IDENT", "ASSIGN", "INT_LIT", "SEMI"]
    assert d["tokens"][3]["start"] == {"offset": 7, "line": 2, "column": 1}
    assert d["tokens"][5]["value"] == 1


@needs_compiler
def test_lex_reports_lexical_errors(client):
    d = ok_data(client.post("/api/lex", json={"source": "int x = 5 @ 3;"}))
    assert d["lexical_errors"][0]["message"].startswith("invalid character")


@needs_compiler
def test_parse_valid_has_ast(client):
    d = ok_data(client.post("/api/parse", json={"source": "int main() { return 1 + 2; }"}))
    assert d["parse"]["ok"] is True
    assert d["parse"]["ast"]["kind"] == "Program"
    assert d["parse"]["ast_hash"]
    assert d["parser_state_info"] is None


@needs_compiler
def test_parse_error_has_expected_tokens_and_state(client):
    d = ok_data(client.post("/api/parse", json={"source": "int main() { int x = 1\n x = 2; }", "trace": True}))
    p = d["parse"]
    assert p["ok"] is False and p["ast"] is None
    diag = p["diagnostics"][0]
    assert "SEMI" in diag["expected"]
    assert diag["start"]["line"] == 2
    assert d["parser_state_info"] is not None
    assert d["parser_state_info"]["number"] == diag["parser_state"]
    assert len(d["parser_state_info"]["items"]) > 0
    assert any("Shifting" in line for line in p["trace"])


@needs_compiler
def test_repair_recommends_semicolon(client):
    src = "int main() {\n  int x = 1\n  x = x + 2;\n  return x;\n}\n"
    d = ok_data(client.post("/api/repair", json={"source": src}))
    r = d["repair"]
    assert r["decision"]["status"] == "RECOMMENDED"
    assert r["decision"]["plans"][0]["source"] == src.replace("int x = 1\n", "int x = 1;\n")
    assert [s["name"] for s in r["stages"]][:2] == ["lex", "parse"]
    top = r["candidates"][0]
    assert top["valid"] and top["roundtrip_ok"]
    assert {e["name"] for e in top["evidence"]} >= {"edit_cost", "resolves_all_errors", "line_end_semicolon"}
    assert d["tau_source"] in ("dev-split selection", "default 1.0")


@needs_compiler
def test_repair_options_change_behaviour(client):
    src = "int main() { int c = a b; return c; }"
    abst = ok_data(client.post("/api/repair", json={"source": src}))
    forced = ok_data(client.post("/api/repair", json={"source": src, "options": {"abstention": False}}))
    assert abst["repair"]["decision"]["status"] == "MULTIPLE_PLAUSIBLE"
    assert forced["repair"]["decision"]["status"] == "RECOMMENDED"
    lc = ok_data(client.post("/api/repair", json={"source": src, "options": {"strategy": "least-cost"}}))
    assert lc["repair"]["config"]["strategy"] == "least-cost"


@needs_compiler
def test_repair_budget_option(client):
    src = "int main() {\n  int x = 1\n  x = x + 2;\n}\n"
    d = ok_data(client.post("/api/repair", json={"source": src, "options": {"max_parses": 10}}))
    assert d["repair"]["budget"]["exhausted"] is True


@needs_compiler
def test_compare_equivalent_and_different(client):
    d = ok_data(client.post("/api/repair/compare", json={"before": "int main() { return (1); }",
                                                          "after": "int main() {\n  return 1;\n}"}))
    assert d["equivalent"] is True and d["changes"] == []
    d = ok_data(client.post("/api/repair/compare", json={"before": "int main() { return a + b; }",
                                                          "after": "int main() { return a * b; }"}))
    assert d["equivalent"] is False
    assert d["changes"][0]["change"] == "changed"
    assert "op" in d["changes"][0]["detail"]


@needs_compiler
def test_compare_with_invalid_side(client):
    d = ok_data(client.post("/api/repair/compare", json={"before": "int main( {", "after": "int main() {}"}))
    assert d["comparable"] is False
    assert d["before"]["diagnostics"]


@needs_compiler
def test_empty_source_is_valid(client):
    d = ok_data(client.post("/api/repair", json={"source": ""}))
    assert d["repair"]["decision"]["status"] == "NO_REPAIR_NEEDED"


@needs_compiler
def test_unicode_and_crlf_input(client):
    d = ok_data(client.post("/api/lex", json={"source": "// héllo\r\nint x;\r\n"}))
    assert d["tokens"][0]["start"]["line"] == 2
    assert d["input"]["crlf_line_breaks"] == 2


# ------------------------------------------------------------------ errors
def test_malformed_json(client):
    r = client.post("/api/lex", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "MALFORMED_JSON"


def test_schema_violation(client):
    r = client.post("/api/lex", json={"source": 42})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "INVALID_REQUEST"
    r = client.post("/api/lex", json={"src": "x"})
    assert r.status_code == 422
    r = client.post("/api/repair", json={"source": "x", "options": {"max_parses": 1}})
    assert r.status_code == 422


def test_oversized_input(client):
    r = client.post("/api/lex", json={"source": "x" * (70 * 1024)})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "INPUT_TOO_LARGE"


@needs_compiler
def test_oversized_after_utf8_encoding(client):
    r = client.post("/api/lex", json={"source": "é" * 40000})  # 40k chars, 80k bytes
    assert r.status_code == 413


def test_missing_compiler_is_503(client, monkeypatch, tmp_path):
    fake = CompilerRunner(Settings(compiler_path=tmp_path / "nope"))
    monkeypatch.setattr(appmain, "runner", fake)
    r = client.post("/api/repair", json={"source": "int main() {}"})
    assert r.status_code == 503
    body = r.json()["error"]
    assert body["code"] == "COMPILER_UNAVAILABLE"
    assert "cmake" in body["hint"]
    assert str(tmp_path) not in json.dumps(r.json())  # no internal paths
    h = client.get("/api/health").json()
    assert h["status"] == "degraded" and h["compiler"]["available"] is False


def _fake_compiler(tmp_path: Path, body: str) -> Path:
    exe = tmp_path / "fakec"
    exe.write_text(f"#!{sys.executable}\n" + textwrap.dedent(body))
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return exe


posix_only = pytest.mark.skipif(os.name == "nt", reason="fake compiler uses a #! script")


@posix_only
def test_timeout_is_504(client, monkeypatch, tmp_path):
    exe = _fake_compiler(tmp_path, "import time\ntime.sleep(5)\n")
    monkeypatch.setattr(appmain, "runner", CompilerRunner(Settings(compiler_path=exe, timeout_s=0.5)))
    r = client.post("/api/lex", json={"source": "int x;"})
    assert r.status_code == 504
    assert r.json()["error"]["code"] == "COMPILER_TIMEOUT"


@posix_only
def test_compiler_crash_is_500(client, monkeypatch, tmp_path):
    exe = _fake_compiler(tmp_path, "import sys\nsys.exit(139)\n")
    monkeypatch.setattr(appmain, "runner", CompilerRunner(Settings(compiler_path=exe)))
    r = client.post("/api/lex", json={"source": "int x;"})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "COMPILER_FAILURE"


@posix_only
def test_compiler_garbage_output_is_500(client, monkeypatch, tmp_path):
    exe = _fake_compiler(tmp_path, "print('not json')\n")
    monkeypatch.setattr(appmain, "runner", CompilerRunner(Settings(compiler_path=exe)))
    r = client.post("/api/lex", json={"source": "int x;"})
    assert r.status_code == 500


def test_unknown_api_route_is_404(client):
    assert client.get("/api/does-not-exist").status_code == 404


# ------------------------------------------------------------------ concurrency
@needs_compiler
def test_concurrent_requests_do_not_interfere(client):
    srcs = {
        "a": "int main() {\n  int x = 1\n  return x;\n}\n",
        "b": "int main() { int c = a b; return c; }",
        "c": "int main() { return 0; }",
        "d": "int f(int a) { if (a > 0 { return 1; } return 0; }",
    }
    expected = {k: ok_data(client.post("/api/repair", json={"source": v}))["repair"]["decision"]["status"]
                for k, v in srcs.items()}

    def go(k):
        return k, ok_data(client.post("/api/repair", json={"source": srcs[k]}))["repair"]["decision"]["status"]

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(go, list(srcs) * 6))
    for k, status in results:
        assert status == expected[k]


# ------------------------------------------------------------------ grammar & evaluation
@needs_compiler
def test_grammar_endpoint(client):
    g = client.get("/api/grammar").json()
    assert "program" in g["grammar_source"]
    assert g["report_available"] is True
    assert g["rules"][0]["lhs"] == "$accept"
    assert g["states"] > 100
    s = client.get("/api/grammar/state/0").json()
    assert s["number"] == 0 and s["items"]
    assert client.get("/api/grammar/state/99999").status_code == 404


def test_evaluation_results_are_stored_real_output(client):
    r = client.get("/api/evaluation/results")
    if r.status_code == 404:
        pytest.skip("no stored evaluation results")
    body = r.json()
    s = body["summary"]
    assert s["n_cases"] == len((PARALLAX_ROOT / "evaluation" / "dataset" / "cases.jsonl").read_text().splitlines())
    assert body["provenance"]["kind"].startswith("stored")
    assert s["tau_selection"]["selected_on"] == "dev"
    stored = PARALLAX_ROOT / "evaluation" / "results" / "clarification_bound.json"
    if stored.is_file():  # the Research page reads the simulation from here, labelled as a simulation
        assert body["clarification"] == json.loads(stored.read_text())
        assert body["clarification"]["test"]["oracle_user"]["n"] == body["clarification"]["test"]["abstained_cases"]


def test_evaluation_case_lookup(client):
    assert client.get("/api/evaluation/case/../../etc").status_code in (400, 404)
    assert client.get("/api/evaluation/case/BAD").status_code == 400
    first = json.loads((PARALLAX_ROOT / "evaluation" / "dataset" / "cases.jsonl").read_text().splitlines()[0])
    c = client.get(f"/api/evaluation/case/{first['id']}").json()
    assert c["corrupted"] == first["corrupted"]


@needs_compiler
def test_live_evaluation_small(client):
    d = ok_data(client.post("/api/evaluate", json={"split": "dev", "limit": 8, "seed": 3}))
    assert d["kind"] == "live evaluation" and d["n"] == 8
    assert 0 <= d["metrics"]["P"]["top1_ast"]["rate"] <= 1
    r = client.post("/api/evaluate", json={"limit": 1000})
    assert r.status_code == 422


def test_docs_endpoints_reject_traversal(client):
    assert client.get("/api/docs/..%2F..%2Fetc").status_code in (400, 404)
    assert client.get("/api/docs/no_such_doc").status_code == 404
    assert client.get("/api/docs/a.b").status_code == 400
    idx = client.get("/api/docs").json()["docs"]
    for d in idx[:3]:
        assert client.get(f"/api/docs/{d['name']}").status_code == 200


def test_mixed_case_docs_open_and_doc_images_are_served_safely(client):
    # Regression: names like IntelliFix_Glossary were listed but returned 400.
    names = [d["name"] for d in client.get("/api/docs").json()["docs"]]
    mixed = [n for n in names if n != n.upper()]
    for n in mixed:
        assert client.get(f"/api/docs/{n}").status_code == 200, n
    img = PARALLAX_ROOT / "docs" / "images" / "walkthrough" / "05-workbench-full-analysis.png"
    if img.is_file():
        r = client.get("/api/docs/images/walkthrough/05-workbench-full-analysis.png")
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    for bad in ("../README.md", "walkthrough/../../../LICENSE", "x.py", "%2e%2e/%2e%2e/LICENSE.png"):
        assert client.get(f"/api/docs/images/{bad}").status_code in (400, 404), bad


def test_static_ui_never_serves_files_outside_dist(client):
    dist = PARALLAX_ROOT / "frontend" / "dist"
    if not dist.is_dir():
        pytest.skip("frontend not built")
    for path in ("/..%2F..%2Fbackend%2Fapp%2Fconfig.py", "/%2e%2e/%2e%2e/LICENSE", "/assets/../../LICENSE"):
        r = client.get(path)
        assert "Permission is hereby granted" not in r.text
        assert "PARALLAX_COMPILER" not in r.text
    assert client.get("/workbench").status_code == 200  # SPA fallback


def test_ui_docs_route_is_not_shadowed_by_swagger(client):
    r = client.get("/docs")
    assert "swagger" not in r.text.lower()
    assert client.get("/api/openapi.json").status_code == 200
