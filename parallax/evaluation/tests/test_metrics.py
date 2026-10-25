"""Unit tests for metric definitions and dataset reproducibility."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from evaluation.lib.compiler import binary_path as compiler_binary  # noqa: E402

from evaluation.metrics.metrics import (  # noqa: E402
    choose_tau, paired_bootstrap_diff, proportion, risk_coverage, status_at_tau, wilson)
from evaluation.generators.generate_dataset import family_split, glue  # noqa: E402


def test_wilson_bounds():
    lo, hi = wilson(50, 100)
    assert 0.40 < lo < 0.41 and 0.59 < hi < 0.60
    assert wilson(0, 0) == (None, None)
    assert wilson(0, 10)[0] == pytest.approx(0.0, abs=1e-12)
    assert wilson(10, 10)[1] == pytest.approx(1.0)


def test_proportion():
    p = proportion([True, False, True, True])
    assert p["k"] == 3 and p["n"] == 4 and p["rate"] == 0.75


def test_status_at_tau_only_touches_margin_statuses():
    assert status_at_tau("RECOMMENDED", 0.5, 1.0) == "MULTIPLE_PLAUSIBLE"
    assert status_at_tau("MULTIPLE_PLAUSIBLE", 2.0, 1.0) == "RECOMMENDED"
    assert status_at_tau("RECOMMENDED", None, 9.0) == "RECOMMENDED"  # single class
    assert status_at_tau("LOW_CONFIDENCE", 9.0, 0.0) == "LOW_CONFIDENCE"
    assert status_at_tau("UNSUPPORTED_CONSTRUCT", 9.0, 0.0) == "UNSUPPORTED_CONSTRUCT"


def test_risk_coverage_perfect_and_worst():
    good = risk_coverage([3, 2, 1, 0], [True, True, False, False])
    bad = risk_coverage([0, 1, 2, 3], [True, True, False, False])
    assert good["aurc"] < bad["aurc"]
    assert abs(good["aurc"] - good["oracle_aurc"]) < 1e-12


def test_choose_tau_prefers_coverage_under_risk_target():
    rows = [{"status": "RECOMMENDED", "margin": m, "ok": ok} for m, ok in [(3, True), (2, True), (0.5, False), (0.2, True)]]
    sel = choose_tau(rows, [0, 1, 2], 0.10, lambda r: r["ok"])
    assert sel["tau"] == 1


def test_bootstrap_deterministic():
    a = [1.0, 0.0, 1.0, 1.0]
    b = [0.0, 0.0, 1.0, 0.0]
    x = paired_bootstrap_diff(a, b, seed=3, reps=200)
    y = paired_bootstrap_diff(a, b, seed=3, reps=200)
    assert x == y and x["diff"] == 0.5


def test_family_split_has_no_overlap_and_is_seeded():
    fams = [f"p{i:02d}" for i in range(30)]
    s1 = family_split(fams, 7, 0.4)
    assert s1 == family_split(fams, 7, 0.4)
    assert sum(v == "dev" for v in s1.values()) == 12


def test_glue_detection():
    assert glue(b"a", b"b") and glue(b"=", b"=") and not glue(b"a", b"(")


def test_dataset_splits_by_family():
    path = ROOT / "evaluation" / "dataset" / "cases.jsonl"
    if not path.exists():
        pytest.skip("dataset not generated")
    cases = [json.loads(l) for l in path.read_text().splitlines()]
    split_of = {}
    for c in cases:
        assert split_of.setdefault(c["family"], c["split"]) == c["split"]
        assert c["corrupted"] != c["original"]


def test_dataset_generation_is_reproducible(tmp_path):
    binary = compiler_binary()
    path = ROOT / "evaluation" / "dataset" / "cases.jsonl"
    if not binary.exists() or not path.exists():
        pytest.skip("compiler or dataset missing")
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    subprocess.run([sys.executable, "-m", "evaluation.generators.generate_dataset"], cwd=ROOT, check=True,
                   capture_output=True)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
