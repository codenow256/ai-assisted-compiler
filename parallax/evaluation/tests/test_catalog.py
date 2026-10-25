"""Asserts the expected behaviour of every error-catalog case (docs/ERROR_CATALOG.md)."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from evaluation.lib.compiler import binary_path as compiler_binary  # noqa: E402

from evaluation.catalog.catalog import CASES, check, run_case  # noqa: E402

pytestmark = pytest.mark.skipif(not (compiler_binary()).exists(), reason="parallaxc not built")


@pytest.mark.parametrize("case", CASES, ids=[c[0] for c in CASES])
def test_catalog_case(case):
    assert check(case, run_case(case)) == []
