"""Runs the professor-style suite against the real compiler (skipped if it is not built)."""
import pytest

from evaluation.lib.compiler import binary_path
from evaluation.professor import run_professor_tests as prof
from evaluation.professor.cases import CASES

pytestmark = pytest.mark.skipif(not binary_path().exists(), reason="compiler not built")


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_hand_written_case(case):
    observed = prof.observe(case["src"])
    assert prof.check_case(case, observed) == [], observed


def test_seeded_fuzzing_invariants():
    fz = prof.fuzz(30, 40, 20, 20, workers=4)
    for kind in ("valid", "mutant", "soup", "bytes"):
        assert fz[kind]["n_violations"] == 0, fz[kind]["violations"]
    assert fz["determinism"]["mismatches"] == []


def test_http_sequences():
    for s in prof.http_sequences():
        assert s["pass"], s
