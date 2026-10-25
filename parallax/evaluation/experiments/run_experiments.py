"""Runs every system on the benchmark and writes REAL measured results.

Usage (from the parallax/ directory, after building the compiler and
generating the dataset):
    python -m evaluation.experiments.run_experiments [--limit N] [--workers K]

Outputs (evaluation/results/):
    summary.json   all metrics, CIs, tau selection, risk-coverage curves
    per_case.jsonl compact per-case predictions of every system
    report.md      human-readable tables generated from summary.json
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import random
import subprocess
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from evaluation.baselines import cpctplus_adapter
from evaluation.baselines.systems import BY_ID, REPAIR_SYSTEMS, SYSTEMS
from evaluation.lib import compiler
from evaluation.metrics.metrics import (
    INF,
    choose_tau,
    paired_bootstrap_diff,
    proportion,
    risk_coverage,
    status_at_tau,
    summary_stats,
)

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "dataset" / "cases.jsonl"
RESULTS = ROOT / "results"

TAU_GRID = [round(0.25 * i, 2) for i in range(0, 17)]  # 0.00 .. 4.00
TARGET_RISK = 0.10
TIMEOUT_S = 30.0


# --------------------------------------------------------------- extraction
def extract_diagnostic(doc: dict) -> dict:
    if "_failure" in doc:
        return {"failure": doc["_failure"], "wall_ms": doc.get("_wall_ms")}
    diags = doc["parse"]["diagnostics"]
    toks = doc["tokens"]
    eof_line = doc["eof"]["line"]
    lines = [t["start"]["line"] for t in toks] + [eof_line]
    return {
        "first_index": diags[0]["token_index"] if diags else None,
        "n_diagnostics": len(diags),
        "lexical_errors": len(doc["lexical_errors"]),
        "token_lines": lines,
        "wall_ms": doc["_wall_ms"],
    }


def extract_repair(doc: dict) -> dict:
    if "_failure" in doc:
        return {"failure": doc["_failure"], "status": "COMPILER_FAILURE", "margin": None, "plans": [],
                "wall_ms": doc.get("_wall_ms")}
    r = doc["repair"]
    d = r["decision"]
    plans = []
    for p in d["plans"]:
        first = p["edits"][0] if p["edits"] else None
        plans.append({
            "tokens": p["tokens"],
            "ast_hash": p.get("ast_hash"),
            "valid": p["valid"],
            "cost": p["total_cost"],
            "n_edits": len(p["edits"]),
            "anchor": first["anchor_token"] if first else None,
            "summary": p["summary"],
        })
    return {
        "status": d["status"],
        "margin": d["margin"],
        "plans": plans,
        "generated": r["counts"]["generated"],
        "accepted": r["counts"]["accepted"],
        "classes": r["counts"]["classes"],
        "parses": r["budget"]["parser_invocations"],
        "engine_ms": r["budget"]["elapsed_ms"],
        "exhausted": r["budget"]["exhausted"],
        "wall_ms": doc["_wall_ms"],
    }


def run_case(case: dict, systems: list[dict]) -> dict:
    out = {"id": case["id"]}
    out["diag"] = extract_diagnostic(compiler.run("analyze", case["corrupted"], timeout=TIMEOUT_S))
    for s in systems:
        if s["family"] != "repair":
            continue
        out[s["id"]] = extract_repair(compiler.run("repair", case["corrupted"], s["args"], timeout=TIMEOUT_S))
    return out


# --------------------------------------------------------------- scoring
def top1_ast(case, pred) -> bool:
    p = pred["plans"][0] if pred.get("plans") else None
    return bool(p and p["valid"] and p["ast_hash"] == case["reference_ast_hash"])


def top1_exact(case, pred) -> bool:
    p = pred["plans"][0] if pred.get("plans") else None
    return bool(p and p["valid"] and p["tokens"] == case["reference_tokens"])


def topk_ast(case, pred, k=3) -> bool:
    return any(p["valid"] and p["ast_hash"] == case["reference_ast_hash"] for p in pred.get("plans", [])[:k])


def output_valid(pred) -> bool:
    p = pred["plans"][0] if pred.get("plans") else None
    return bool(p and p["valid"])


def is_recommended(sys_def, pred, tau) -> bool:
    if sys_def.get("abstains"):
        return status_at_tau(pred["status"], pred["margin"], tau) == "RECOMMENDED"
    return pred["status"] == "RECOMMENDED"


def confidence(sys_def, pred) -> float:
    """Ordering score for risk-coverage. Abstaining systems: tier then
    margin (single-class = +inf). Least-cost baseline: lower cost first."""
    if not pred.get("plans") or not pred["plans"][0]["valid"]:
        return -1e9
    if sys_def["id"] == "C":
        return -pred["plans"][0]["cost"]
    tier = 1e6 if pred["status"] in ("RECOMMENDED", "MULTIPLE_PLAUSIBLE") else 0.0
    m = pred["margin"]
    return tier + (1e5 if m is None else max(-1e5, min(1e5, m)))


def localisation(case, idx, lines) -> dict:
    site = case["site"]
    if idx is None:
        return {"exact": False, "near": False, "line": False}
    li = lines[min(idx, len(lines) - 1)]
    ls = lines[min(site, len(lines) - 1)]
    return {"exact": idx == site, "near": abs(idx - site) <= 1, "line": li == ls}


# --------------------------------------------------------------- optional G
def run_cpct(case: dict) -> dict:
    """CPCT+ (nimbleparse) on one case; plans re-parsed by parallaxc."""
    toks = compiler.run("lex", case["corrupted"], timeout=TIMEOUT_S)["tokens"]
    try:
        res = cpctplus_adapter.run(toks, timeout=TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - external tool, record and continue
        return {"failure": f"{type(exc).__name__}: {exc}", "plans": [], "wall_ms": None}
    plans = []
    for lexemes in res["plans"]:
        doc = compiler.run("analyze", " ".join(lexemes), timeout=TIMEOUT_S)
        ok = "parse" in doc and doc["parse"]["ok"]
        plans.append({"valid": ok, "ast_hash": doc["parse"].get("ast_hash") if ok else None,
                      "tokens": lexemes})
    anchor = None
    if res["errors"] and res["errors"][0]["sequences"]:
        seq = res["errors"][0]["sequences"][0]
        shifts = 0
        for op, _ in seq:
            if op != "Shift":
                break
            shifts += 1
        anchor = res["errors"][0]["token_index"] + shifts
    return {"plans": plans, "anchor": anchor, "wall_ms": res["wall_ms"],
            "n_errors_reported": len(res["errors"])}


def evaluate_cpct(cases, rows_g, diag_rows) -> dict:
    by_id = {r["id"]: r for r in rows_g}
    dby = {r["id"]: r for r in diag_rows}
    preds = [(c, by_id[c["id"]]) for c in cases]
    t1 = [top1_ast(c, p) for c, p in preds]
    loc = [localisation(c, p.get("anchor"), dby[c["id"]]["diag"]["token_lines"]) for c, p in preds]
    return {
        "top1_ast": proportion(t1),
        "top1_exact": proportion([top1_exact(c, p) for c, p in preds]),
        "top3_ast": proportion([topk_ast(c, p) for c, p in preds]),
        "output_parser_valid": proportion([output_valid(p) for c, p in preds]),
        "localisation_exact": proportion([l["exact"] for l in loc]),
        "localisation_within_1": proportion([l["near"] for l in loc]),
        "localisation_same_line": proportion([l["line"] for l in loc]),
        "latency_ms": summary_stats(p.get("wall_ms") for c, p in preds),
        "failures": sum(1 for c, p in preds if "failure" in p),
    }


def evaluate_split(cases, rows, tau, systems=None) -> dict:
    by_id = {r["id"]: r for r in rows}
    res = {}
    # Diagnostic baselines
    loc_a = [localisation(c, by_id[c["id"]]["diag"].get("first_index"), by_id[c["id"]]["diag"]["token_lines"])
             for c in cases if "failure" not in by_id[c["id"]]["diag"]]
    res["A"] = {
        "detected": proportion([by_id[c["id"]]["diag"].get("first_index") is not None for c in cases]),
        "localisation_exact": proportion([l["exact"] for l in loc_a]),
        "localisation_within_1": proportion([l["near"] for l in loc_a]),
        "localisation_same_line": proportion([l["line"] for l in loc_a]),
        "latency_ms": summary_stats(by_id[c["id"]]["diag"]["wall_ms"] for c in cases),
    }
    lex_cases = [c for c in cases if c["category"] == "invalid-character"]
    res["A"]["lexical_error_detection"] = proportion([by_id[c["id"]]["diag"]["lexical_errors"] > 0 for c in lex_cases])
    nd = [by_id[c["id"]]["diag"]["n_diagnostics"] for c in cases]
    spurious = [max(0, by_id[c["id"]]["diag"]["n_diagnostics"] - c["n_errors"]) for c in cases]
    multi = [c for c in cases if c["n_errors"] > 1]
    res["B"] = {
        "diagnostics_per_case": summary_stats(nd),
        "spurious_diagnostics_per_case": summary_stats(spurious),
        "cases_with_spurious": proportion([s > 0 for s in spurious]),
        "multi_error_all_reported": proportion([by_id[c["id"]]["diag"]["n_diagnostics"] >= c["n_errors"] for c in multi]),
        "localisation_same_line": res["A"]["localisation_same_line"],
    }
    for s in (systems or REPAIR_SYSTEMS):
        sid = s["id"]
        preds = [(c, by_id[c["id"]][sid]) for c in cases]
        rec = [is_recommended(s, p, tau) for c, p in preds]
        t1 = [top1_ast(c, p) for c, p in preds]
        rec_pairs = [(r, ok) for r, ok in zip(rec, t1) if r]
        loc = [localisation(c, (p["plans"][0]["anchor"] if p.get("plans") else None),
                            by_id[c["id"]]["diag"]["token_lines"]) for c, p in preds]
        statuses = Counter(
            (status_at_tau(p["status"], p["margin"], tau) if s.get("abstains") else p["status"]) for c, p in preds)
        rc = risk_coverage([confidence(s, p) for c, p in preds], t1)
        res[sid] = {
            "top1_ast": proportion(t1),
            "top1_exact": proportion([top1_exact(c, p) for c, p in preds]),
            "top3_ast": proportion([topk_ast(c, p) for c, p in preds]),
            "output_parser_valid": proportion([output_valid(p) for c, p in preds]),
            "coverage": proportion(rec),
            "selective_accuracy": proportion([ok for r, ok in rec_pairs]),
            "false_confident_rate": proportion([r and not ok for r, ok in zip(rec, t1)]),
            "abstention_rate": proportion([not r for r in rec]),
            "localisation_exact": proportion([l["exact"] for l in loc]),
            "localisation_within_1": proportion([l["near"] for l in loc]),
            "localisation_same_line": proportion([l["line"] for l in loc]),
            "status_counts": dict(sorted(statuses.items())),
            "aurc": rc["aurc"],
            "oracle_aurc": rc["oracle_aurc"],
            "risk_coverage": rc["curve"],
            "candidates_generated": summary_stats(p.get("generated") for c, p in preds),
            "classes": summary_stats(p.get("classes") for c, p in preds),
            "parser_invocations": summary_stats(p.get("parses") for c, p in preds),
            "engine_ms": summary_stats(p.get("engine_ms") for c, p in preds),
            "latency_ms": summary_stats(p.get("wall_ms") for c, p in preds),
            "budget_exhausted": proportion([bool(p.get("exhausted")) for c, p in preds]),
            "compiler_failures": sum(1 for c, p in preds if "failure" in p),
        }
    return res


def breakdown(cases, rows, tau, key) -> dict:
    by_id = {r["id"]: r for r in rows}
    groups = defaultdict(list)
    for c in cases:
        groups[c[key]].append(c)
    out = {}
    for g, cs in sorted(groups.items()):
        entry = {"n": len(cs)}
        for sid in ("C", "F", "P"):
            s = BY_ID[sid]
            preds = [(c, by_id[c["id"]][sid]) for c in cs]
            t1 = [top1_ast(c, p) for c, p in preds]
            rec = [is_recommended(s, p, tau) for c, p in preds]
            entry[sid] = {
                "top1_ast": sum(t1) / len(cs),
                "top3_ast": sum(topk_ast(c, p) for c, p in preds) / len(cs),
                "coverage": sum(rec) / len(cs),
                "false_confident": sum(1 for r, ok in zip(rec, t1) if r and not ok) / len(cs),
            }
        out[g] = entry
    return out


def failure_examples(cases, rows, tau, limit=12) -> list[dict]:
    by_id = {r["id"]: r for r in rows}
    out = []
    for c in cases:
        p = by_id[c["id"]]["P"]
        if is_recommended(BY_ID["P"], p, tau) and not top1_ast(c, p):
            e = c["edits"][0]
            out.append({
                "id": c["id"], "category": c["category"], "ambiguity": c["ambiguity"],
                "injected": f'{e["op"]} {e.get("removed") or ""} -> {e.get("inserted") or ""} at {e["line"]}:{e["column"]}',
                "parallax_repair": p["plans"][0]["summary"] if p["plans"] else None,
                "margin": p["margin"],
            })
    return out[:limit]


def environment() -> dict:
    def cmd(*a):
        try:
            return subprocess.run(list(a), capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[0]
        except Exception:  # noqa: BLE001 - environment probing only
            return None
    ver = compiler.run("version", "")
    commit = cmd("git", "-C", str(ROOT), "rev-parse", "--short", "HEAD")
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_count": os.cpu_count(),
        "compiler": {k: ver.get(k) for k in ("name", "version")},
        "bison": cmd("bison", "--version"),
        "flex": cmd("flex", "--version"),
        "git_commit": commit,
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="evaluate only the first N cases (smoke runs)")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument("--out", type=Path, default=RESULTS)
    ap.add_argument("--no-cpct", action="store_true", help="skip the optional CPCT+ baseline")
    ap.add_argument("--split", choices=["all", "dev"], default="all",
                    help="'dev' evaluates only the tuning split (used while developing the evidence model)")
    args = ap.parse_args()

    if not DATASET.exists():
        print("dataset missing: run python -m evaluation.generators.generate_dataset", file=sys.stderr)
        return 1
    cases = [json.loads(l) for l in DATASET.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.split == "dev":
        cases = [c for c in cases if c["split"] == "dev"]
    if args.limit:
        cases = cases[: args.limit]
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        rows = list(ex.map(lambda c: run_case(c, SYSTEMS), cases))
    elapsed = time.time() - t0

    dev = [c for c in cases if c["split"] == "dev"]
    test = [c for c in cases if c["split"] == "test"]
    by_id = {r["id"]: r for r in rows}
    dev_rows = [{"status": by_id[c["id"]]["P"]["status"], "margin": by_id[c["id"]]["P"]["margin"],
                 "case": c, "pred": by_id[c["id"]]["P"]} for c in dev]
    tau_sel = choose_tau(dev_rows, TAU_GRID, TARGET_RISK, lambda r: top1_ast(r["case"], r["pred"]))
    tau = tau_sel["tau"]

    # Sanity check: re-running the binary with --tau reproduces the offline
    # re-thresholded status on a deterministic sample of test cases.
    rng = random.Random(1)
    sample = rng.sample(test, min(25, len(test))) if test else []
    tau_agree = 0  # (named apart from the CPCT+ replicate list below, which used to overwrite it)
    for c in sample:
        doc = compiler.run("repair", c["corrupted"], ["--tau", str(tau)], timeout=TIMEOUT_S)
        direct = doc["repair"]["decision"]["status"] if "repair" in doc else "COMPILER_FAILURE"
        p = by_id[c["id"]]["P"]
        if direct == status_at_tau(p["status"], p["margin"], tau):
            tau_agree += 1

    cpct = None
    status = cpctplus_adapter.availability()
    if status["available"] and not args.no_cpct:
        reps = []
        for rep in range(2):  # CPCT+ breaks ties non-deterministically: two replicates
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                reps.append(list(ex.map(lambda c: {"id": c["id"], **run_cpct(c)}, cases)))
        r0 = {r["id"]: r for r in reps[0]}
        r1 = {r["id"]: r for r in reps[1]}
        agree = [((r0[c["id"]]["plans"] or [{}])[0].get("ast_hash") == (r1[c["id"]]["plans"] or [{}])[0].get("ast_hash"))
                 for c in cases]
        cpct = {
            "availability": status,
            "replicates": 2,
            "replicate_top1_agreement": proportion(agree),
            "test": [evaluate_cpct(test, reps[k], rows) for k in range(2)] if test else None,
            "dev": [evaluate_cpct(dev, reps[k], rows) for k in range(2)] if dev else None,
            "note": "Real nimbleparse runs; wall time includes grammar loading and LR table construction "
                    "on every invocation; CPCT+ never abstains.",
        }
    else:
        cpct = {"availability": status if not args.no_cpct else {"available": False, "reason": "--no-cpct"}}

    summary = {
        "cpctplus": cpct,
        "environment": environment(),
        "dataset": json.loads((ROOT / "dataset" / "manifest.json").read_text()),
        "n_cases": len(cases),
        "limit": args.limit or None,
        "runtime_seconds": elapsed,
        "systems": SYSTEMS,
        "tau_selection": {**tau_sel, "target_risk": TARGET_RISK, "selected_on": "dev",
                          "offline_rethreshold_check": {"sample": len(sample), "agree": tau_agree}},
        "dev": evaluate_split(dev, rows, tau) if dev else None,
        "test": evaluate_split(test, rows, tau) if test else None,
        "test_default_tau": evaluate_split(test, rows, 1.0) if test else None,
        "test_by_category": breakdown(test, rows, tau, "category") if test else None,
        "test_by_ambiguity": breakdown(test, rows, tau, "ambiguity") if test else None,
        "test_by_kind": breakdown(test, rows, tau, "kind") if test else None,
        "failure_examples": failure_examples(test, rows, tau) if test else [],
    }
    if test:
        P = [top1_ast(c, by_id[c["id"]]["P"]) for c in test]
        C = [top1_ast(c, by_id[c["id"]]["C"]) for c in test]
        E = [top1_ast(c, by_id[c["id"]]["E"]) for c in test]
        L = [top1_ast(c, by_id[c["id"]]["L"]) for c in test]
        fc_p = [is_recommended(BY_ID["P"], by_id[c["id"]]["P"], tau) and not ok for c, ok in zip(test, P)]
        fc_f = [by_id[c["id"]]["F"]["status"] == "RECOMMENDED" and not top1_ast(c, by_id[c["id"]]["F"]) for c in test]
        summary["paired_tests"] = {
            "top1_ast_P_minus_C": paired_bootstrap_diff([float(x) for x in P], [float(x) for x in C]),
            "top1_ast_P_minus_E": paired_bootstrap_diff([float(x) for x in P], [float(x) for x in E]),
            "top1_ast_P_minus_L": paired_bootstrap_diff([float(x) for x in P], [float(x) for x in L]),
            "false_confident_P_minus_F": paired_bootstrap_diff([float(x) for x in fc_p], [float(x) for x in fc_f]),
        }

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    with open(out / "per_case.jsonl", "w", encoding="utf-8") as f:
        for c in cases:
            r = by_id[c["id"]]
            row = {"id": c["id"], "split": c["split"], "category": c["category"], "ambiguity": c["ambiguity"],
                   "site": c["site"], "raw_first_error": r["diag"].get("first_index"),
                   "panic_diagnostics": r["diag"].get("n_diagnostics")}
            for s in REPAIR_SYSTEMS:
                p = r[s["id"]]
                row[s["id"]] = {"status": p["status"], "margin": p["margin"], "top1_ast": top1_ast(c, p),
                                "top3_ast": topk_ast(c, p), "repair": p["plans"][0]["summary"] if p.get("plans") else None,
                                "wall_ms": round(p.get("wall_ms") or 0, 2)}
            f.write(json.dumps(row) + "\n")
    from evaluation.experiments.report import write_report  # local import: avoids a cycle at module load
    write_report(summary, out / "report.md")
    print(f"evaluated {len(cases)} cases in {elapsed:.1f}s; tau={tau}; results in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
