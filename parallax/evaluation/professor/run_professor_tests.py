"""Professor-style robustness and capability tests for IntelliFix.

Three parts, all executed against the REAL compiler:
  1. hand-written cases (cases.py): stated expectations vs observed behaviour;
  2. seeded fuzzing: grammar-generated valid programs, single-token mutants,
     token soup and random bytes, each checked against hard invariants;
  3. HTTP sequences through the FastAPI app (failed request then valid,
     invalid then valid, oversized, malformed JSON, concurrency).

Writes docs/IntelliFix_Random_Input_Test_Report.md and
evaluation/results/professor_results.json.

Usage (from parallax/):  python -m evaluation.professor.run_professor_tests [--quick]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from evaluation.lib import compiler  # noqa: E402
from evaluation.professor.cases import CASES  # noqa: E402

SEED = 20261025


def ui_tau() -> float:
    """The threshold the backend (and so the UI) uses: tau selected on dev by the stored evaluation."""
    try:
        return float(json.loads((ROOT / "evaluation" / "results" / "summary.json").read_text())["tau_selection"]["tau"])
    except (OSError, KeyError, ValueError):
        return 1.0


TAU = ui_tau()
TAU_ARGS = ["--tau", repr(TAU)]
STATUS_UI = {
    "NO_REPAIR_NEEDED": "green badge “No repair needed”; parser row says “accepted”",
    "RECOMMENDED": "green badge “Recommended repair”; diff of the single recommended fix with an Accept button",
    "MULTIPLE_PLAUSIBLE": "amber badge “Multiple plausible repairs”; top-ranked fix shown as *not recommended*, alternatives in the Repair lab",
    "LOW_CONFIDENCE": "amber badge “Low confidence”; best fix shown (it invents content or cannot fix later errors)",
    "NO_SAFE_REPAIR": "red badge “No safe automatic repair”; diagnostics only",
    "BUDGET_EXHAUSTED": "red badge “Search budget exhausted”",
    "UNSUPPORTED_CONSTRUCT": "blue badge “Unsupported construct” with the reason (a C feature MiniC omits, or the parser nesting limit)",
}


# ---------------------------------------------------------------- part 1
def observe(src: str) -> dict:
    t = time.perf_counter()
    doc = compiler.run("repair", src, TAU_ARGS, timeout=60)
    wall = (time.perf_counter() - t) * 1000
    if "_failure" in doc:
        return {"failure": doc["_failure"], "wall_ms": wall}
    p = doc["parse"]
    d = doc["repair"]["decision"]
    diag = p["diagnostics"][0] if p["diagnostics"] else None
    return {
        "lex_errors": [e["message"] for e in doc["lexical_errors"]],
        "tokens": len(doc["tokens"]),
        "parse_ok": p["ok"],
        "first_error": (f"{diag['start']['line']}:{diag['start']['column']}" if diag else None),
        "first_message": diag["message"] if diag else None,
        "resource_limit": p["resource_limit"],
        "status": d["status"],
        "margin": d["margin"],
        "plan": d["plans"][0]["source"] if d["plans"] else None,
        "plan_summary": d["plans"][0]["summary"] if d["plans"] else None,
        "candidates": doc["repair"]["counts"]["generated"],
        "accepted": doc["repair"]["counts"]["accepted"],
        "wall_ms": wall,
    }


def check_case(c: dict, o: dict) -> list[str]:
    bad = []
    if "failure" in o:
        return [f"compiler failure: {o['failure']}"]
    lex = c.get("lex")
    if lex == "clean" and o["lex_errors"]:
        bad.append(f"expected no lexical errors, got {o['lex_errors'][:1]}")
    elif lex and lex != "clean" and not any(lex in m for m in o["lex_errors"]):
        bad.append(f"expected a lexical error containing {lex!r}")
    parse = c.get("parse")
    if parse == "accept" and not o["parse_ok"]:
        bad.append(f"expected the parser to accept (got {o['first_message']} at {o['first_error']})")
    if parse and parse.startswith("reject"):
        if o["parse_ok"]:
            bad.append("expected the parser to reject")
        elif "@" in parse and o["first_error"] != parse.split("@")[1]:
            bad.append(f"expected first error at {parse.split('@')[1]} (got {o['first_error']})")
    if c.get("status") and o["status"] not in c["status"]:
        bad.append(f"expected status in {sorted(c['status'])} (got {o['status']})")
    if c.get("plan_contains") and (not o["plan"] or c["plan_contains"] not in o["plan"]):
        bad.append(f"expected the top plan to contain {c['plan_contains']!r}")
    if c.get("plan_not_contains") and o["plan"] and c["plan_not_contains"] in o["plan"]:
        bad.append(f"top plan still contains {c['plan_not_contains']!r}")
    if o["wall_ms"] > 15000:
        bad.append(f"took {o['wall_ms']:.0f} ms (> 15 s)")
    return bad


# ---------------------------------------------------------------- part 2: fuzzing
TYPES = ["int", "float", "char", "bool"]
BIN = ["+", "-", "*", "/", "%", "<", "<=", ">", ">=", "==", "!=", "&&", "||"]


class Gen:
    """Generates random programs that are valid MiniC by construction."""

    def __init__(self, rng: random.Random):
        self.r = rng

    def expr(self, d: int, names: list[str]) -> str:
        r = self.r
        if d <= 0 or r.random() < 0.3:
            k = r.random()
            if names and k < 0.45:
                return r.choice(names)
            if k < 0.75:
                return str(r.randint(0, 999))
            if k < 0.85:
                return f"{r.randint(0, 99)}.{r.randint(0, 9)}"
            if k < 0.92:
                return r.choice(["true", "false"])
            return "'" + r.choice("abcxyz") + "'"
        k = r.random()
        if k < 0.55:
            return f"{self.expr(d - 1, names)} {r.choice(BIN)} {self.expr(d - 1, names)}"
        if k < 0.7:
            return f"({self.expr(d - 1, names)})"
        if k < 0.8:
            # the space matters: "-" + "-i" would lex as the C decrement "--" (maximal munch)
            return f"{r.choice(['-', '!'])} {self.expr(d - 1, names)}"
        if k < 0.9:
            return f"g({self.expr(d - 1, names)}, {self.expr(d - 1, names)})"
        return f"arr[{self.expr(d - 1, names)}]"

    def stmt(self, d: int, names: list[str], ind: str) -> str:
        r = self.r
        k = r.random()
        if d <= 0 or k < 0.3:
            if k < 0.12 or not names:
                n = f"v{r.randint(0, 999)}"
                names.append(n)
                return f"{ind}{r.choice(TYPES)} {n} = {self.expr(2, names[:-1])};\n"
            if k < 0.25:
                return f"{ind}{r.choice(names)} = {self.expr(2, names)};\n"
            return f"{ind}g({self.expr(1, names)}, {self.expr(1, names)});\n"
        if k < 0.45:
            body = self.block(d - 1, list(names), ind)
            els = f" else {self.block(d - 1, list(names), ind)}" if r.random() < 0.4 else ""
            return f"{ind}if ({self.expr(2, names)}) {body}{els}\n"
        if k < 0.6:
            return f"{ind}while ({self.expr(2, names)}) {self.block(d - 1, list(names), ind)}\n"
        if k < 0.72:
            return f"{ind}for (int i = 0; i < {r.randint(1, 9)}; i = i + 1) {self.block(d - 1, list(names) + ['i'], ind)}\n"
        if k < 0.8:
            return f"{ind}return {self.expr(2, names)};\n"
        if k < 0.85:
            return f"{ind}{r.choice(['break', 'continue'])};\n"
        if k < 0.9:
            return f"{ind};\n"
        return f"{ind}{self.block(d - 1, list(names), ind).strip()}\n"

    def block(self, d: int, names: list[str], ind: str) -> str:
        inner = ind + "  "
        body = "".join(self.stmt(d, names, inner) for _ in range(self.r.randint(0, 4)))
        return "{\n" + body + ind + "}"

    def program(self) -> str:
        r = self.r
        out = ["int arr[10];\n", "int g(int a, int b) { return a + b; }\n"]
        for f in range(r.randint(1, 3)):
            params = [f"p{i}" for i in range(r.randint(0, 3))]
            sig = ", ".join(f"{r.choice(TYPES)} {p}" for p in params)
            out.append(f"{r.choice(TYPES + ['void'])} f{f}({sig}) {self.block(3, params + ['arr'], '')}\n")
        return "".join(out)


def invariants(src: str, doc: dict, wall_ms: float, must_parse: bool) -> list[str]:
    """Hard properties that must hold for ANY input."""
    bad = []
    if "_failure" in doc:
        return [f"compiler failure: {doc['_failure']}"]
    b = src.encode("utf-8")
    last = 0
    for t in doc["tokens"]:
        s, e = t["start"]["offset"], t["end"]["offset"]
        if not (last <= s < e <= len(b)):
            bad.append(f"token span out of order/range: {t['kind']} {s}-{e}")
            break
        if b[s:e].decode("utf-8", "replace") != t["lexeme"] and t["kind"] != "ERROR":
            bad.append(f"lexeme mismatch at {s}: {t['lexeme']!r}")
            break
        last = e
    p = doc["parse"]
    st = doc["repair"]["decision"]["status"]
    if p["ok"] and (st != "NO_REPAIR_NEEDED" or p["ast"] is None):
        bad.append(f"valid input but status {st} / ast {p['ast'] is not None}")
    if not p["ok"] and st == "NO_REPAIR_NEEDED":
        bad.append("invalid input reported as needing no repair")
    if must_parse and not p["ok"]:
        d = p["diagnostics"][0]
        bad.append(f"generated valid program rejected: {d['message']} at {d['start']['line']}:{d['start']['column']}")
    if st == "RECOMMENDED":
        plan = doc["repair"]["decision"]["plans"][0]
        if not plan["valid"]:
            bad.append("recommended plan does not parse")
    for c in doc["repair"]["candidates"][:3]:
        if c["valid"]:
            re = compiler.run("analyze", c["source"], timeout=30)
            if "_failure" in re or not re["parse"]["ok"]:
                bad.append(f"candidate marked parser-valid does not re-parse: {c['summary']}")
    if wall_ms > 10000:
        bad.append(f"slow: {wall_ms:.0f} ms")
    return bad


def mutate(src: str, rng: random.Random) -> str:
    toks = compiler.run("lex", src)["tokens"]
    if not toks:
        return src + ";"
    t = rng.choice(toks)
    b = src.encode()
    s, e = t["start"]["offset"], t["end"]["offset"]
    op = rng.choice(["delete", "insert", "replace", "swap"])
    pool = [";", ")", "(", "{", "}", ",", "=", "+", "*", "int", "x", "1", "if", "@"]
    if op == "delete":
        out = b[:s] + b" " + b[e:]
    elif op == "insert":
        out = b[:s] + rng.choice(pool).encode() + b" " + b[s:]
    elif op == "replace":
        out = b[:s] + rng.choice(pool).encode() + b[e:]
    else:
        j = toks.index(t)
        if j + 1 >= len(toks):
            return src + "}"
        u = toks[j + 1]
        out = b[:s] + u["lexeme"].encode() + b[e:u["start"]["offset"]] + t["lexeme"].encode() + b[u["end"]["offset"]:]
    return out.decode("utf-8", "replace")


def fuzz(n_valid: int, n_mut: int, n_soup: int, n_bytes: int, workers: int) -> dict:
    rng = random.Random(SEED)
    gen = Gen(rng)
    valid = [gen.program() for _ in range(n_valid)]
    mut_rng = random.Random(SEED + 1)
    mutants = [mutate(rng.choice(valid), mut_rng) for _ in range(n_mut)]
    lex_pool = ["int", "float", "if", "else", "while", "for", "return", "x", "y", "f", "0", "1.5", "'a'", "true",
                "+", "-", "*", "/", "=", "==", "<", "&&", "!", "(", ")", "{", "}", "[", "]", ";", ","]
    srng = random.Random(SEED + 2)
    soups = [" ".join(srng.choice(lex_pool) for _ in range(srng.randint(1, 40))) for _ in range(n_soup)]
    brng = random.Random(SEED + 3)
    alphabet = [chr(c) for c in range(32, 127)] + ["\n", "\t", "\r"]
    noise = ["".join(brng.choice(alphabet) for _ in range(brng.randint(0, 200))) for _ in range(n_bytes)]

    def run(item):
        kind, src = item
        t = time.perf_counter()
        doc = compiler.run("repair", src, TAU_ARGS, timeout=60)
        wall = (time.perf_counter() - t) * 1000
        return kind, src, doc, wall, invariants(src, doc, wall, must_parse=(kind == "valid"))

    items = [("valid", s) for s in valid] + [("mutant", s) for s in mutants] + \
            [("soup", s) for s in soups] + [("bytes", s) for s in noise]
    with ThreadPoolExecutor(workers) as ex:
        results = list(ex.map(run, items))
    # determinism on a sample
    det_bad = []
    for kind, src, doc, _, _ in results[:: max(1, len(results) // 40)]:
        again = compiler.run("repair", src, TAU_ARGS, timeout=60)
        if "_failure" not in doc and "_failure" not in again:
            a = (doc["repair"]["decision"]["status"], [p["summary"] for p in doc["repair"]["decision"]["plans"]])
            b = (again["repair"]["decision"]["status"], [p["summary"] for p in again["repair"]["decision"]["plans"]])
            if a != b:
                det_bad.append(src[:80])
    summary = {}
    for kind in ("valid", "mutant", "soup", "bytes"):
        rs = [r for r in results if r[0] == kind]
        statuses: dict[str, int] = {}
        for r in rs:
            if "_failure" not in r[2]:
                s = r[2]["repair"]["decision"]["status"]
                statuses[s] = statuses.get(s, 0) + 1
        walls = sorted(r[3] for r in rs)
        summary[kind] = {
            "n": len(rs),
            "violations": [{"input": r[1][:300], "problems": r[4]} for r in rs if r[4]][:20],
            "n_violations": sum(1 for r in rs if r[4]),
            "statuses": dict(sorted(statuses.items())),
            "max_ms": walls[-1] if walls else 0,
            "median_ms": walls[len(walls) // 2] if walls else 0,
        }
    summary["determinism"] = {"checked": len(results[:: max(1, len(results) // 40)]), "mismatches": det_bad}
    summary["seed"] = SEED
    summary["examples"] = {"valid": valid[0], "mutant": mutants[0], "soup": soups[0]}
    return summary


# ---------------------------------------------------------------- part 3: HTTP sequences
def http_sequences() -> list[dict]:
    from fastapi.testclient import TestClient

    from app import main as appmain

    c = TestClient(appmain.app)
    out = []

    def rec(id_, title, ok, detail):
        out.append({"id": id_, "title": title, "pass": bool(ok), "detail": detail})

    valid = "int main() { return 0; }"
    bad = "int main() { int x = 1\n return x; }"
    r1 = c.post("/api/repair", json={"source": bad}).json()["data"]["repair"]["decision"]["status"]
    r2 = c.post("/api/repair", json={"source": valid}).json()["data"]["repair"]["decision"]["status"]
    rec("H01", "valid input immediately after invalid input (cat. 28)", r1 == "RECOMMENDED" and r2 == "NO_REPAIR_NEEDED",
        f"invalid → {r1}; then valid → {r2}")
    codes = [c.post("/api/lex", json={"source": "x" * 70000}).status_code,
             c.post("/api/lex", content=b"{bad json", headers={"content-type": "application/json"}).status_code,
             c.post("/api/lex", json={"source": 5}).status_code]
    after = c.post("/api/parse", json={"source": valid})
    rec("H02", "repeated requests after failed requests (cat. 27)", codes == [413, 422, 422] and after.status_code == 200
        and after.json()["data"]["parse"]["ok"], f"failures returned {codes}; next valid request → HTTP {after.status_code}, ok={after.json()['data']['parse']['ok']}")
    same = [c.post("/api/repair", json={"source": bad}).json()["data"]["repair"]["decision"]["plans"][0]["summary"]
            for _ in range(5)]
    rec("H03", "the same invalid input five times gives the same answer", len(set(same)) == 1, f"plans: {set(same)}")
    srcs = [valid, bad, "int main() { int c = a b; }", "int main() { i++; }"] * 4

    def go(s):
        return s, c.post("/api/repair", json={"source": s}).json()["data"]["repair"]["decision"]["status"]

    seq = dict(go(s) for s in srcs[:4])
    with ThreadPoolExecutor(8) as ex:
        par = list(ex.map(go, srcs))
    rec("H04", "16 concurrent mixed requests give the sequential answers", all(seq[s] == st for s, st in par),
        f"{len(par)} parallel requests; statuses {sorted(set(st for _, st in par))}")
    e = c.post("/api/repair", json={"source": ""}).json()["data"]["repair"]["decision"]["status"]
    w = c.post("/api/repair", json={"source": " \n\t "}).json()["data"]["repair"]["decision"]["status"]
    rec("H05", "empty and whitespace-only input", e == w == "NO_REPAIR_NEEDED", f"empty → {e}; whitespace → {w}")
    big = "int main() {\n" + "  int x = 1;\n" * 4000 + "}\n"
    t = time.perf_counter()
    rb = c.post("/api/repair", json={"source": big})
    rec("H06", f"large valid input ({len(big)} bytes, under the 64 KB limit)", rb.status_code == 200,
        f"HTTP {rb.status_code} in {(time.perf_counter() - t) * 1000:.0f} ms")
    html = c.post("/api/lex", json={"source": "int main() { /* <script>alert(1)</script> */ return 0; }"}).json()
    rec("H07", "HTML in the source is returned as data, not markup", "<script>" not in json.dumps(html["data"]["tokens"]),
        "comments are trivia; token lexemes never contain the markup (the UI also renders all compiler text as text)")
    return out


# ---------------------------------------------------------------- report
def esc(s: str, n: int = 160) -> str:
    s = s if len(s) <= n else s[:n] + f" … ({len(s)} chars)"
    return s.replace("\\", "\\\\").replace("|", "\\|").replace("\n", "↵").replace("\r", "␍").replace("\t", "⇥").replace("`", "ˋ").translate({c: f"\\x{c:02x}" for c in list(range(0, 32)) + [127] if c not in (9, 10, 13)})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="smaller fuzz sizes")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    sizes = (40, 60, 30, 30) if args.quick else (200, 300, 150, 150)

    rows = []
    for c in CASES:
        o = observe(c["src"])
        bad = check_case(c, o)
        rows.append((c, o, bad))
    fz = fuzz(*sizes, workers=args.workers)
    seqs = http_sequences()

    passed = sum(1 for _, _, b in rows if not b)
    fz_viol = sum(fz[k]["n_violations"] for k in ("valid", "mutant", "soup", "bytes")) + len(fz["determinism"]["mismatches"])
    seq_pass = sum(1 for s in seqs if s["pass"])
    results = {
        "seed": SEED,
        "hand_cases": [{"id": c["id"], "title": c["title"], "observed": o, "problems": b} for c, o, b in rows],
        "fuzz": fz,
        "http_sequences": seqs,
        "totals": {"hand_passed": passed, "hand_total": len(rows), "fuzz_inputs": sum(fz[k]["n"] for k in ("valid", "mutant", "soup", "bytes")),
                   "fuzz_violations": fz_viol, "http_passed": seq_pass, "http_total": len(seqs)},
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (ROOT / "evaluation" / "results").mkdir(exist_ok=True)
    (ROOT / "evaluation" / "results" / "professor_results.json").write_text(json.dumps(results, indent=1) + "\n")

    L = ["# IntelliFix — random-input and professor-style test report (generated)", "",
         f"> Generated by `python -m evaluation.professor.run_professor_tests` on {results['timestamp_utc']} "
         f"against the real `parallaxc` compiler and the real FastAPI app, at the threshold the UI uses (τ = {TAU}). Nothing in the *Actual* column is written by hand. "
         "Raw data: `evaluation/results/professor_results.json`.", "",
         "## Summary", "",
         f"| Part | Executed | Passed | Failed |", "|---|---|---|---|",
         f"| Hand-written cases (expectation stated before running) | {len(rows)} | {passed} | {len(rows) - passed} |",
         f"| Fuzzing inputs checked against invariants (seed {SEED}) | {results['totals']['fuzz_inputs']} | {results['totals']['fuzz_inputs'] - sum(fz[k]['n_violations'] for k in ('valid', 'mutant', 'soup', 'bytes'))} | {sum(fz[k]['n_violations'] for k in ('valid', 'mutant', 'soup', 'bytes'))} |",
         f"| Determinism re-runs | {fz['determinism']['checked']} | {fz['determinism']['checked'] - len(fz['determinism']['mismatches'])} | {len(fz['determinism']['mismatches'])} |",
         f"| HTTP request sequences | {len(seqs)} | {seq_pass} | {len(seqs) - seq_pass} |", "",
         "**How to read “Expected”.** *Grammar* says whether the input is valid MiniC (`in`), MiniC with mistakes (`error`) or not MiniC at all (`outside`). "
         "*Repair* lists the statuses that are acceptable; for ambiguous inputs more than one status is honest behaviour, and the expectation says so instead of pretending to know the single right answer.", "",
         "## Part 1 — hand-written cases", "",
         "| ID | Cat. | Case | Input | Grammar | Expected lexer | Expected parser | Expected repair status | Expected UI | Actual | Result | Explanation |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for c, o, bad in rows:
        if "failure" in o:
            actual = f"FAILURE {o['failure']}"
        else:
            parts = [f"{o['tokens']} tokens", ("lexical: " + "; ".join(o["lex_errors"])[:80]) if o["lex_errors"] else "no lexical errors",
                     "accepted" if o["parse_ok"] else f"rejected at {o['first_error']}: {o['first_message']}" + (" (nesting limit)" if o["resource_limit"] else ""),
                     f"**{o['status']}**"]
            if o["plan_summary"] and o["status"] != "NO_REPAIR_NEEDED":
                parts.append(f"top plan: {o['plan_summary']}")
            parts.append(f"{o['wall_ms']:.0f} ms")
            actual = "; ".join(parts)
        exp_status = " / ".join(sorted(c.get("status") or [])) or "—"
        sts = c.get("status") or set()
        if len(sts) >= 4:
            ui = "a repair badge (any of the listed statuses), never “No repair needed”; first diagnostic underlined in the editor"
        else:
            ui = "; ".join(STATUS_UI[x].split(";")[0] for x in sorted(sts)) or "—"
        L.append("| " + " | ".join([
            c["id"], str(c["cat"]), esc(c["title"], 60), f"`{esc(c['src'], 110)}`", c["grammar"], esc(str(c.get("lex") or "—"), 40),
            esc(str(c.get("parse") or "—"), 20), exp_status, esc(ui, 140), esc(actual, 260),
            "PASS" if not bad else "FAIL: " + esc("; ".join(bad), 160),
            esc(c.get("explain", "") + (f" **Expectation corrected:** {c['corrected']}." if c.get("corrected") else ""), 400)]) + " |")
    corr = [c for c in CASES if c.get("corrected")]
    if corr:
        L += ["", f"**Expectation corrections ({len(corr)}).** Each was changed for the stated reason (documented behaviour, or the P86 fix), not by copying the output: "
              + ", ".join(c["id"] for c in corr) + "."]
    weak = [c for c in CASES if c.get("weakness")]
    if weak:
        L += ["", f"**Observed weaknesses ({len(weak)}).** These cases pass because their expectation allows several statuses, but the actual top repair is "
              "not what a programmer meant. They are left unfixed on purpose: changing the evidence weights after looking at outputs would be tuning on test data. "
              "They are documented in KNOWN_LIMITATIONS.md and the viva material.", ""]
        L += [f"- {c['id']} ({c['title']}): {c['weakness']}." for c in weak]
    L += ["", "**Defects found and fixed by this suite (2).** (1) P86 (a valid program nested 3000 blocks deep) exceeded the parser's stack. "
          "The repair engine treated that as a syntax error, searched for about 3.5 s and offered brace deletions, none of which parsed. "
          "It now stops and reports `UNSUPPORTED_CONSTRUCT` with the capacity limit as the reason "
          "(`compiler/src/repair_engine.cpp`, regression test `repair_parser_nesting_limit_is_reported_not_repaired`). "
          "(2) P73 (unterminated `/*`): the engine recommended replacing the whole comment with `}`, which parses but silently discards the code inside it. "
          "Plans that delete or replace a multi-line lexical-error token are now capped at `LOW_CONFIDENCE` (regression test `repair_never_recommends_discarding_an_unterminated_comment`).",
          "", "**Test-generator bug found and fixed.** The first fuzzing run generated `- -i` without a space, which lexes as the C decrement `--` "
          "(as it would in C). The generator was wrong, not the compiler; it now writes a space after unary operators."]
    L += ["", "## Part 2 — seeded fuzzing", "",
          "Every fuzz input must satisfy the invariants: exit status 0 with valid JSON; token spans in order, inside the input, with each lexeme equal to its exact source bytes; "
          "valid input reported as `NO_REPAIR_NEEDED` with an AST; invalid input never reported as needing no repair; generated valid programs accepted; "
          "a `RECOMMENDED` plan always parses; the top three candidates marked parser-valid re-parse on their own; at most 10 s per input.", "",
          "| Input family | Inputs | Invariant violations | Status distribution | Median ms | Max ms |", "|---|---|---|---|---|---|"]
    names = {"valid": "grammar-generated valid programs", "mutant": "single random token mutation of a valid program",
             "soup": "random sequences of MiniC tokens", "bytes": "random printable characters"}
    for k in ("valid", "mutant", "soup", "bytes"):
        f = fz[k]
        L.append(f"| {names[k]} | {f['n']} | {f['n_violations']} | {', '.join(f'{s}: {n}' for s, n in f['statuses'].items())} | {f['median_ms']:.0f} | {f['max_ms']:.0f} |")
    L += ["", f"Determinism: {fz['determinism']['checked']} inputs re-run, {len(fz['determinism']['mismatches'])} mismatches.", ""]
    for k in ("valid", "mutant", "soup", "bytes"):
        for v in fz[k]["violations"]:
            L.append(f"- **violation ({k})**: `{esc(v['input'], 200)}` → {esc('; '.join(v['problems']), 300)}")
    L += ["", "Example generated valid program:", "", "```c", fz["examples"]["valid"].rstrip(), "```", "",
          "## Part 3 — HTTP request sequences", "", "| ID | Scenario | Result | Observed |", "|---|---|---|---|"]
    for s in seqs:
        L.append(f"| {s['id']} | {s['title']} | {'PASS' if s['pass'] else 'FAIL'} | {esc(s['detail'], 200)} |")
    L += ["", "## What these tests do not show", "",
          "- They exercise the compiler and the API; browser-level behaviour (stale-result banners, button states) is covered by the frontend unit and end-to-end tests (`docs/TESTING.md`).",
          "- Passing invariants means *no crash, no inconsistent output*. It does not mean every repair matches the programmer's intent; see the evaluation for accuracy.",
          "- Inputs outside MiniC (C/C++ features) are expected to be rejected or reported as unsupported; they are not bugs.", ""]
    (ROOT / "docs" / "IntelliFix_Random_Input_Test_Report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(json.dumps(results["totals"]))
    for c, o, bad in rows:
        if bad:
            print("FAIL", c["id"], bad, "| observed:", o.get("status"), o.get("first_error"), o.get("plan_summary"))
    for k in ("valid", "mutant", "soup", "bytes"):
        for v in fz[k]["violations"][:5]:
            print("FUZZ", k, v)
    for s in seqs:
        if not s["pass"]:
            print("HTTP FAIL", s)
    return 0 if passed == len(rows) and fz_viol == 0 and seq_pass == len(seqs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
