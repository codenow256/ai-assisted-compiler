"""Offline bound for interactive clarification on the ambiguous subset.

Question: when IntelliFix abstains (MULTIPLE_PLAUSIBLE or LOW_CONFIDENCE at the
UI threshold), how often does the clarification card contain the correct
repair among the options it shows?

The card offers the decision's top plans (up to 3 structurally distinct
classes), which is exactly what `top3_ast` measures in the stored results.
This is a SIMULATION with two idealised users, not a user study:
  - "first option" user: always picks option 1      (= top-1 AST match)
  - "oracle" user: recognises the right option if shown (= top-3 AST match)
Placeholder plans are shown as a fill-in box; the simulation cannot type a
name, so cases recovered only through a fill-in are not counted.

Reads evaluation/results/per_case.jsonl and summary.json; writes
evaluation/results/clarification_bound.json. Run from parallax/:
    python3 -m evaluation.experiments.clarification_bound
"""
from __future__ import annotations

import json
from pathlib import Path

from evaluation.metrics.metrics import status_at_tau, wilson

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    summary = json.loads((ROOT / "results" / "summary.json").read_text())
    tau = summary["tau_selection"]["tau"]
    rows = [json.loads(line) for line in (ROOT / "results" / "per_case.jsonl").open()]
    out = {"tau": tau, "note": __doc__.strip().splitlines()[0]}
    for split in ("dev", "test"):
        sub = [r for r in rows if r["split"] == split and status_at_tau(r["P"]["status"], r["P"]["margin"], tau) in ("MULTIPLE_PLAUSIBLE", "LOW_CONFIDENCE")]
        n = len(sub)
        first = sum(bool(r["P"]["top1_ast"]) for r in sub)
        oracle = sum(bool(r["P"]["top3_ast"]) for r in sub)
        by_amb = {}
        for r in sub:
            a = by_amb.setdefault(r["ambiguity"], {"n": 0, "first": 0, "oracle": 0})
            a["n"] += 1
            a["first"] += bool(r["P"]["top1_ast"])
            a["oracle"] += bool(r["P"]["top3_ast"])
        out[split] = {
            "abstained_cases": n,
            "of_split": sum(1 for r in rows if r["split"] == split),
            "first_option_user": {"k": first, "n": n, "rate": first / n if n else None, "ci95": wilson(first, n) if n else None},
            "oracle_user": {"k": oracle, "n": n, "rate": oracle / n if n else None, "ci95": wilson(oracle, n) if n else None},
            "by_ambiguity": by_amb,
        }
    path = ROOT / "results" / "clarification_bound.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    t = out["test"]
    print(f"test: {t['abstained_cases']} abstained cases; first option correct {t['first_option_user']['k']}/{t['abstained_cases']}; "
          f"correct option shown {t['oracle_user']['k']}/{t['abstained_cases']}")
    print(json.dumps(t["by_ambiguity"]))


if __name__ == "__main__":
    main()
