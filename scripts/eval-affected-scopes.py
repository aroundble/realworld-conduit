#!/usr/bin/env python3
"""
Companion helper for eval-affected-scopes.sh.

Reads tests/affected-map.yaml path from argv[1]. Reads one changed-
file path per line on stdin. Emits FULL= / FULL_REASON= / SCOPES=
lines on stdout.

No pyyaml dependency required; falls back to a minimal parser for
the known schema. If pyyaml is installed it's used directly.
"""

from __future__ import annotations

import os
import re
import sys


def match_glob(pattern: str, path: str) -> bool:
    """Match a single ** / * glob against a path string.

    ** matches any number of path segments (including none).
    * matches a single path segment.
    """
    regex = re.escape(pattern)
    # **  ->  .*
    regex = regex.replace(r"\*\*", "__DSTAR__")
    # *   ->  [^/]*
    regex = regex.replace(r"\*", "[^/]*")
    regex = regex.replace("__DSTAR__", ".*")
    return re.fullmatch(regex, path) is not None


def load_map(path: str) -> dict:
    try:
        import yaml  # type: ignore

        with open(path) as fh:
            return yaml.safe_load(fh) or {}
    except ImportError:
        pass

    cfg: dict = {"full_triggers": [], "scopes": {}}
    cur_section: str | None = None
    cur_scope: str | None = None
    cur_list_key: str | None = None
    with open(path) as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line or line.lstrip().startswith("#"):
                continue
            stripped = line.lstrip()
            indent = len(line) - len(stripped)
            if indent == 0 and stripped.endswith(":"):
                cur_section = stripped[:-1]
                cur_scope = None
                cur_list_key = None
                if cur_section == "full_triggers":
                    cfg["full_triggers"] = []
                elif cur_section == "scopes":
                    cfg["scopes"] = {}
                continue
            if cur_section == "full_triggers" and stripped.startswith("- "):
                cfg["full_triggers"].append(
                    stripped[2:].strip().strip('"').strip("'"),
                )
                continue
            if cur_section == "scopes":
                if indent == 2 and stripped.endswith(":"):
                    cur_scope = stripped[:-1]
                    cfg["scopes"][cur_scope] = {
                        "files": [],
                        "specs": [],
                        "newman": [],
                        "uat": [],
                    }
                    cur_list_key = None
                    continue
                if indent == 4 and stripped.endswith(":") and cur_scope:
                    cur_list_key = stripped[:-1]
                    cfg["scopes"][cur_scope].setdefault(cur_list_key, [])
                    continue
                if (
                    indent >= 6
                    and stripped.startswith("- ")
                    and cur_scope
                    and cur_list_key
                ):
                    cfg["scopes"][cur_scope][cur_list_key].append(
                        stripped[2:].strip().strip('"').strip("'"),
                    )
                    continue
    return cfg


def main() -> int:
    if len(sys.argv) < 2:
        print("FULL=1")
        print("FULL_REASON=no map-path argument")
        print("SCOPES=")
        return 0

    map_path = sys.argv[1]
    changed = [line.strip() for line in sys.stdin if line.strip()]

    if not changed:
        print("FULL=0")
        print("FULL_REASON=")
        print("SCOPES=")
        return 0

    try:
        cfg = load_map(map_path)
    except Exception as exc:
        print("FULL=1")
        print(f"FULL_REASON=map parse error: {exc}")
        print("SCOPES=")
        return 0

    triggers = cfg.get("full_triggers") or []
    scopes_cfg = cfg.get("scopes") or {}

    # Trigger check.
    for p in changed:
        for t in triggers:
            if match_glob(t, p):
                print("FULL=1")
                print(f"FULL_REASON=shared trigger: {p} matches {t}")
                print("SCOPES=")
                return 0

    # Scope match.
    matched: set[str] = set()
    for p in changed:
        for name, scope_cfg in scopes_cfg.items():
            for g in scope_cfg.get("files") or []:
                if match_glob(g, p):
                    matched.add(name)
                    break

    if not matched:
        print("FULL=1")
        print("FULL_REASON=no scope match; conservative fallback")
        print("SCOPES=")
        return 0

    print(f"SCOPES={' '.join(sorted(matched))}")
    print("FULL=0")
    print("FULL_REASON=")
    return 0


if __name__ == "__main__":
    sys.exit(main())
