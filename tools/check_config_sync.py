#!/usr/bin/env python3
"""Fail if navcore tuning constants differ between the firmware and the browser emulator.

firmware/lib/navcore/src/navcore/config.h  (constexpr NAME = value;)
planner/src/navcore/config.ts              (NAME: value,)

Both sides must define the same names with the same numeric values. Values may be simple
arithmetic (e.g. 8 / 3.6), evaluated by a tiny AST walker (no eval).
"""
import ast
import operator
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CPP = ROOT / "firmware/lib/navcore/src/navcore/config.h"
TS = ROOT / "planner/src/navcore/config.ts"

CPP_RE = re.compile(r"constexpr\s+\w+\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);")
TS_RE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*:\s*([^,]+),", re.MULTILINE)
# Independent declaration counts, so a constant the main regex misses can't vanish silently.
CPP_COUNT_RE = re.compile(r"\bconstexpr\b")
TS_COUNT_RE = re.compile(r"^\s*[A-Z][A-Z0-9_]*\s*:", re.MULTILINE)

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def evaluate(expr: str, where: str) -> float:
    """Evaluate + - * / arithmetic on number literals (C++ `f` suffixes allowed). No eval()."""
    src = re.sub(r"(?<=[0-9.])f\b", "", expr.strip())

    def walk(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return float(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            v = walk(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:  # no ** : can't blow up CI
            return _OPS[type(node.op)](walk(node.left), walk(node.right))
        raise ValueError(f"{type(node).__name__} not allowed")

    try:
        return walk(ast.parse(src, mode="eval"))
    except (SyntaxError, ValueError, ZeroDivisionError) as e:
        sys.exit(f"{where}: unsupported value expression {expr.strip()!r} ({e})")


def strip_comments(text: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL))


def load(path: pathlib.Path, pattern: re.Pattern, count_re: re.Pattern) -> dict:
    text = strip_comments(path.read_text(encoding="utf-8"))
    pairs = pattern.findall(text)
    names = [n for n, _ in pairs]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        sys.exit(f"{path.name}: defined more than once: {', '.join(dupes)}")
    declared = len(count_re.findall(text))
    if not pairs or declared != len(pairs):
        sys.exit(f"{path.name}: {declared} declarations but {len(pairs)} parsed — use `constexpr T NAME = value;` / `NAME: value,`")
    return {name: evaluate(value, f"{path.name}:{name}") for name, value in pairs}


def main() -> int:
    cpp, ts = load(CPP, CPP_RE, CPP_COUNT_RE), load(TS, TS_RE, TS_COUNT_RE)
    problems = []
    for name in sorted(cpp.keys() - ts.keys()):
        problems.append(f"{name}: only in config.h")
    for name in sorted(ts.keys() - cpp.keys()):
        problems.append(f"{name}: only in config.ts")
    for name in sorted(cpp.keys() & ts.keys()):
        if abs(cpp[name] - ts[name]) > 1e-6 * max(1.0, abs(ts[name])):
            problems.append(f"{name}: config.h={cpp[name]} config.ts={ts[name]}")
    if problems:
        print("navcore config drift between firmware and planner:")
        print("\n".join(f"  - {p}" for p in problems))
        return 1
    print(f"navcore config in sync ({len(cpp)} constants)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
