"""Fail loudly if anything key-shaped is tracked by git (or staged).

    python scripts/check_no_keys.py           # scan tracked + staged files
    python scripts/check_no_keys.py --staged  # pre-commit style: staged only

Checks:
  * no .env file is tracked or staged (only .env.example is allowed)
  * no FAKE lab key  (FAKE-<SYSTEM>-<32 hex>)
  * no common real-key shapes (sk_live_/pk_live_, AWS AKIA..., GitHub ghp_,
    a bare 40-hex string next to a *_API_KEY= assignment)
Exit code 1 on any hit. No network access.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = [
    ("FAKE lab key", re.compile(r"FAKE-[A-Z]+-[0-9a-f]{32}")),
    ("stripe-style live/test key", re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("API key assignment", re.compile(r"_API_KEY\s*=\s*['\"]?[A-Za-z0-9]{32,}")),
]
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".gif", ".zip", ".ico", ".pdf"}
# files that document the key FORMAT with obviously non-secret examples
ALLOW = {"scripts/check_no_keys.py", "tests/test_server.py", "tests/test_parity.py"}


def git_files(staged: bool) -> list[str]:
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"] if staged else ["git", "ls-files"]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    if not staged:
        out += subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout.split("\n")
    return sorted({f for f in out if f})


def main() -> int:
    staged = "--staged" in sys.argv
    hits: list[str] = []
    for f in git_files(staged):
        name = Path(f).name
        if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
            hits.append(f"{f}: env files must never be committed")
            continue
        if Path(f).suffix.lower() in SKIP_SUFFIX or f in ALLOW:
            continue
        p = ROOT / f
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for label, rx in PATTERNS:
            for m in rx.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append(f"{f}:{line}: {label} (...{m.group(0)[-4:]})")
    if hits:
        print("SECRET SCAN FAILED — remove these, and rotate any real key that was ever committed:")
        for h in hits:
            print("  " + h)
        return 1
    print(f"secret scan: clean ({'staged' if staged else 'tracked + staged'} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
