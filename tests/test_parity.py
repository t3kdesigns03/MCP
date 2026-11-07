"""The browser (visual/js/tools.js) and the server (mcp_server/lab.py) must
agree. Runs the same scripted calls through both and diffs the results.
Needs Node.js on PATH; skipped otherwise."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mcp_server"))

from lab import Lab, LabStore  # noqa: E402

ENV = {
    "EMAIL_API_KEY": "FAKE-EMAIL-" + "a" * 32,
    "MERAKI_API_KEY": "FAKE-MERAKI-" + "b" * 32,
    "MONITORING_API_KEY": "FAKE-MONITORING-" + "c" * 32,
    "SALESFORCE_API_KEY": "FAKE-SALESFORCE-" + "d" * 32,
    "IPAM_API_KEY": "FAKE-IPAM-" + "e" * 32,
}
VOLATILE = {"rev", "updated_at"}


def scrub(o):
    if isinstance(o, dict):
        return {k: scrub(v) for k, v in o.items() if k not in VOLATILE}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    if isinstance(o, float) and o.is_integer():
        return int(o)
    return o


@unittest.skipUnless(shutil.which("node"), "node not installed")
class Parity(unittest.TestCase):
    def test_same_results(self):
        calls = json.loads((ROOT / "tests" / "parity_calls.json").read_text())
        lab = Lab(LabStore(path=None), env=ENV, clock=lambda: "2026-11-07T12:00:00Z")
        py = [lab.call(n, a) for n, a in calls]
        js = json.loads(subprocess.run(["node", str(ROOT / "tests" / "run_js_tools.js"), json.dumps(ENV)],
                                       capture_output=True, text=True, check=True, encoding="utf-8").stdout)
        for i, ((name, args), p, j) in enumerate(zip(calls, py, js["results"])):
            self.assertEqual(scrub(p), scrub(j), f"call #{i} {name} {args} differs")
        self.assertEqual(scrub(lab.s), scrub(js["state"]), "final lab_state differs")


if __name__ == "__main__":
    unittest.main(verbosity=2)
