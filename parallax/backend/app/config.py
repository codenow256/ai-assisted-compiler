"""Runtime configuration (environment variables, safe defaults)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PARALLAX_ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = PARALLAX_ROOT / "compiler" / "build"


def locate_compiler(build_dir: Path = BUILD_DIR) -> Path:
    """Finds the parallaxc binary produced by CMake on any platform.

    Single-config generators (Makefiles, Ninja, MinGW) put it in the build
    root; multi-config generators (Visual Studio) put it in Release/, Debug/
    or RelWithDebInfo/. On Windows the file has an .exe suffix. The first
    existing candidate wins; if none exists the conventional path is
    returned so error messages stay meaningful.
    """
    override = os.environ.get("PARALLAX_COMPILER")
    if override:
        return Path(override)
    names = ["parallaxc.exe", "parallaxc"] if os.name == "nt" else ["parallaxc", "parallaxc.exe"]
    for sub in ("", "Release", "RelWithDebInfo", "MinSizeRel", "Debug"):
        for name in names:
            candidate = build_dir / sub / name if sub else build_dir / name
            if candidate.is_file():
                return candidate
    return build_dir / names[0]


@dataclass(frozen=True)
class Settings:
    compiler_path: Path = field(default_factory=locate_compiler)
    parser_report: Path = field(default_factory=lambda: Path(
        os.environ.get("PARALLAX_PARSER_REPORT", PARALLAX_ROOT / "compiler" / "build" / "parser.output")))
    grammar_file: Path = PARALLAX_ROOT / "compiler" / "grammar" / "minic.y"
    lexer_file: Path = PARALLAX_ROOT / "compiler" / "grammar" / "minic.l"
    examples_dir: Path = PARALLAX_ROOT / "examples"
    results_dir: Path = field(default_factory=lambda: Path(
        os.environ.get("PARALLAX_RESULTS", PARALLAX_ROOT / "evaluation" / "results")))
    timeout_s: float = float(os.environ.get("PARALLAX_TIMEOUT_S", "15"))
    max_concurrency: int = int(os.environ.get("PARALLAX_MAX_CONCURRENCY", "4"))
    max_input_bytes: int = 64 * 1024
    cors_origins: tuple[str, ...] = tuple(
        o.strip() for o in os.environ.get(
            "PARALLAX_CORS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173").split(",")
        if o.strip())


def get_settings() -> Settings:
    return Settings()
