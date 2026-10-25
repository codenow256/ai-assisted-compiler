"""Async, sandboxed invocation of the parallaxc binary.

* argument arrays only (no shell), source on stdin — no injection surface;
* no temporary files, so concurrent requests cannot race on shared paths;
* a hard timeout per call (the process is killed on expiry);
* a semaphore bounds concurrent compiler processes;
* failures map to typed exceptions that the API turns into distinct
  HTTP statuses (compiler missing vs. timeout vs. crash).
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass

from pathlib import Path

from .config import BUILD_DIR, Settings, locate_compiler


class CompilerError(Exception):
    code = "COMPILER_FAILURE"
    http_status = 500

    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.hint = hint


class CompilerUnavailable(CompilerError):
    code = "COMPILER_UNAVAILABLE"
    http_status = 503


class CompilerTimeout(CompilerError):
    code = "COMPILER_TIMEOUT"
    http_status = 504


class InputTooLarge(CompilerError):
    code = "INPUT_TOO_LARGE"
    http_status = 413


BUILD_HINT = ("Build the native compiler first: cmake -S compiler -B compiler/build && "
              "cmake --build compiler/build --config Release. On Windows this needs a C++ compiler "
              "(Visual Studio Build Tools with 'Desktop development with C++', or MSYS2 MinGW-w64) "
              "plus win_flex/win_bison; see docs/INSTALLATION_AND_TROUBLESHOOTING.md, section 3.")


@dataclass
class CompilerResult:
    doc: dict
    wall_ms: float


class CompilerRunner:
    """Runs parallaxc in a worker thread with subprocess.run.

    A thread + subprocess.run is used instead of asyncio subprocesses because
    asyncio can only spawn processes on some Windows event loops (uvicorn's
    reload mode uses one that cannot). A threading.BoundedSemaphore bounds
    concurrent compiler processes across all requests and event loops.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self._slots = threading.BoundedSemaphore(settings.max_concurrency)

    def binary(self) -> Path:
        """The configured path, re-located if the compiler was built (e.g. into
        build/Release/ by Visual Studio) after the server started."""
        p = self.settings.compiler_path
        if not p.is_file() and not os.environ.get("PARALLAX_COMPILER") and BUILD_DIR in p.parents:
            return locate_compiler()
        return p

    def available(self) -> bool:
        p = self.binary()
        return p.is_file() and os.access(p, os.X_OK)

    def _run_sync(self, cmd: list[str], data: bytes, timeout: float):
        with self._slots:
            start = time.perf_counter()
            try:
                proc = subprocess.run(cmd, input=data, capture_output=True, timeout=timeout)
            except FileNotFoundError as exc:
                raise CompilerUnavailable("The compiler binary disappeared or cannot be started.", BUILD_HINT) from exc
            except PermissionError as exc:
                raise CompilerUnavailable("The compiler binary is not executable.", BUILD_HINT) from exc
            except OSError as exc:
                raise CompilerUnavailable(f"The compiler could not be started ({exc.strerror}).", BUILD_HINT) from exc
            except subprocess.TimeoutExpired as exc:
                # subprocess.run kills the child before raising
                raise CompilerTimeout(f"The compiler did not finish within {timeout:g} s and was stopped.",
                                      "Try a smaller input or lower search limits.") from exc
            return proc, (time.perf_counter() - start) * 1000

    async def run(self, mode: str, source: str, args: list[str] | None = None,
                  timeout_s: float | None = None) -> CompilerResult:
        if not self.available():
            raise CompilerUnavailable("The parallaxc compiler binary was not found or is not executable.", BUILD_HINT)
        data = source.encode("utf-8")
        if len(data) > self.settings.max_input_bytes:
            raise InputTooLarge(f"Input is {len(data)} bytes; the limit is {self.settings.max_input_bytes} bytes.")
        timeout = timeout_s or self.settings.timeout_s
        cmd = [str(self.binary()), mode, *(args or [])]
        proc, wall = await asyncio.to_thread(self._run_sync, cmd, data, timeout)
        if proc.returncode == 3:
            raise InputTooLarge("The compiler rejected the input as too large.")
        if proc.returncode != 0:
            raise CompilerError(f"The compiler exited with status {proc.returncode}.",
                                "This is an internal compiler failure, not a problem with your MiniC code.")
        try:
            doc = json.loads(proc.stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CompilerError("The compiler produced output that is not valid JSON.") from exc
        if "error" in doc and "mode" not in doc:
            raise CompilerError(doc["error"].get("message", "compiler usage error"))
        return CompilerResult(doc=doc, wall_ms=wall)

    async def version(self) -> dict | None:
        try:
            return (await self.run("version", "", timeout_s=5)).doc
        except CompilerError:
            return None
