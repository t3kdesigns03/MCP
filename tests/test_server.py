"""End-to-end checks of the real FastMCP server over the MCP protocol.

    .venv/Scripts/python -m unittest discover -s tests -v      (Windows)
    .venv/bin/python -m unittest discover -s tests -v          (macOS/Linux)

Uses a throwaway state file and generated FAKE keys. No network.
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="agent0067-test-"))
os.environ["AGENT0067_STATE"] = str(TMP / "state.json")
FAKE = {env: f"FAKE-{env.split('_')[0]}-{secrets.token_hex(16)}" for env in (
    "EMAIL_API_KEY", "MERAKI_API_KEY", "MONITORING_API_KEY", "SALESFORCE_API_KEY", "IPAM_API_KEY")}
os.environ.update(FAKE)
sys.path.insert(0, str(ROOT / "mcp_server"))

from fastmcp import Client  # noqa: E402

import server  # noqa: E402
from lab import TOOL_NAMES  # noqa: E402


def run(coro):
    return asyncio.run(coro)


async def call(name: str, args: dict | None = None) -> dict:
    async with Client(server.mcp) as c:
        r = await c.call_tool(name, args or {}, raise_on_error=False)
        return r.structured_content or json.loads(r.content[0].text)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.store.reset()

    def test_01_discovery_lists_every_tool(self):
        async def go():
            async with Client(server.mcp) as c:
                return await c.list_tools()
        tools = run(go())
        names = sorted(t.name for t in tools)
        self.assertEqual(names, sorted(TOOL_NAMES))
        self.assertEqual(len(names), 17)
        blob = json.dumps([t.model_dump(mode="json") for t in tools])
        for key in FAKE.values():
            self.assertNotIn(key, blob, "a key leaked into tool discovery")
        self.assertNotIn("://", blob, "the model should never see an API URL")
        ro = {t.name for t in tools if t.annotations and t.annotations.read_only_hint}
        self.assertIn("integrations.meraki.get_devices", ro)
        self.assertNotIn("integrations.ipam.allocate", ro)

    def test_02_topology_build(self):
        sw = run(call("lab.topology.add_node", {"type": "switch", "label": "SW-CORE", "integrations": ["meraki", "monitoring", "ipam"]}))
        self.assertTrue(sw["ok"], sw)
        pc = run(call("lab.topology.add_node", {"type": "pc", "label": "PC-01"}))
        srv = run(call("lab.topology.add_node", {"type": "server", "label": "SRV-MAIL", "integrations": ["email", "monitoring"]}))
        self.assertTrue(run(call("lab.topology.connect", {"a": "PC-01", "b": "SW-CORE"}))["ok"])
        self.assertTrue(run(call("lab.topology.connect", {"a": "sw1", "b": "srv1"}))["ok"])
        dup = run(call("lab.topology.connect", {"a": "sw1", "b": "pc1"}))
        self.assertEqual(dup["error"], "duplicate_link")
        topo = run(call("lab.topology.get"))
        self.assertEqual(topo["counts"], {"nodes": 3, "edges": 2})
        on_disk = json.loads(Path(os.environ["AGENT0067_STATE"]).read_text())
        self.assertEqual(len(on_disk["nodes"]), 3, "topology must land in lab_state")
        self.assertEqual(pc["node"]["id"], "pc1")
        self.assertEqual(srv["node"]["integrations"], ["email", "monitoring"])

    def test_03_device_tools(self):
        self.assertEqual(run(call("lab.device.list"))["count"], 3)
        ins = run(call("lab.device.inspect", {"device_id": "SW-CORE"}))
        self.assertEqual(len(ins["neighbors"]), 2)
        ping = run(call("lab.device.run_command", {"device_id": "pc1", "command": "ping SRV-MAIL"}))
        self.assertTrue(ping["success"])
        self.assertEqual(ping["path"], ["PC-01", "SW-CORE", "SRV-MAIL"])
        bad = run(call("lab.device.run_command", {"device_id": "pc1", "command": "rm -rf /"}))
        self.assertEqual(bad["error"], "invalid_input")

    def test_04_each_system_reflects_in_state(self):
        # email
        p = run(call("integrations.email.send", {"to": "dispatch@neonharbor.example", "subject": "Dockside", "body": "Looking now."}))
        self.assertEqual(p["status"], "confirmation_required")
        s = run(call("integrations.email.send", {"to": "dispatch@neonharbor.example", "subject": "Dockside", "body": "Looking now.", "confirm": True}))
        self.assertTrue(s["ok"])
        sent = run(call("integrations.email.list", {"folder": "sent"}))
        self.assertIn(s["message"]["id"], [m["id"] for m in sent["messages"]])
        self.assertEqual(sent["auth"]["key"], "..." + FAKE["EMAIL_API_KEY"][-4:])
        # meraki
        nets = run(call("integrations.meraki.get_networks"))
        status = {n["name"]: n["status"] for n in nets["networks"]}
        self.assertEqual(status["Branch-Dockside"], "down")
        self.assertEqual(status["Branch-RailYard"], "degraded")
        off = run(call("integrations.meraki.get_devices", {"status": "offline"}))
        self.assertEqual({d["name"] for d in off["devices"]}, {"DOCK-MX", "DOCK-MS"})
        cfg = run(call("integrations.meraki.update_config", {"serial": "Q2FK-LAB-SW1", "changes": {"access_vlan": 10}, "confirm": True}))
        self.assertTrue(cfg["ok"], cfg)
        self.assertEqual(run(call("lab.device.inspect", {"device_id": "sw1"}))["device"]["config"]["access_vlan"], 10)
        # monitoring
        run(call("lab.device.run_command", {"device_id": "SW-CORE", "command": "send test-trap"}))
        alerts = run(call("integrations.monitoring.get_alerts"))
        self.assertTrue(any("TEST-TRAP" in a["message"] for a in alerts["alerts"]))
        self.assertTrue(run(call("integrations.monitoring.get_metrics", {"device": "SW-CORE"}))["ok"])
        # salesforce
        q = run(call("integrations.salesforce.query", {"soql": "SELECT CaseNumber, Subject FROM Case WHERE Status = 'Open'"}))
        self.assertEqual(q["totalSize"], 2)
        case = run(call("integrations.salesforce.create_case", {"subject": "Dockside down", "account": "Dockside", "priority": "High", "confirm": True}))
        self.assertTrue(case["ok"])
        q2 = run(call("integrations.salesforce.query", {"soql": "SELECT CaseNumber FROM Case WHERE Subject LIKE 'Dockside%'"}))
        self.assertEqual(q2["records"][0]["CaseNumber"], case["case"]["CaseNumber"])
        # ipam
        before = {s["id"]: s["free"] for s in run(call("integrations.ipam.get_subnets"))["subnets"]}
        a = run(call("integrations.ipam.allocate", {"subnet": "sn-hq-users", "hostname": "label-printer", "confirm": True}))
        self.assertEqual(a["allocation"]["ip"], "10.67.10.12")
        after = {s["id"]: s["free"] for s in run(call("integrations.ipam.get_subnets"))["subnets"]}
        self.assertEqual(after["sn-hq-users"], before["sn-hq-users"] - 1)
        # verification panel recorded every step
        v = json.loads(Path(os.environ["AGENT0067_STATE"]).read_text())["verification"]
        self.assertEqual({k: v[k]["status"] for k in v}, {k: "pass" for k in ("ping", "alert", "case", "allocate", "config")})

    def test_05_keys_live_on_server(self):
        saved = os.environ.pop("MERAKI_API_KEY")
        try:
            r = run(call("integrations.meraki.get_networks"))
            self.assertEqual(r["error"], "missing_api_key")
            os.environ["MERAKI_API_KEY"] = "sk_live_" + "x" * 32
            r = run(call("integrations.meraki.get_networks"))
            self.assertEqual(r["error"], "rejected_api_key")
        finally:
            os.environ["MERAKI_API_KEY"] = saved

    def test_06_every_tool_returns_structured_data(self):
        """All 17 tools answer over MCP with a structured dict — no 'Unknown tool'."""
        args = {
            "lab.topology.add_node": {"type": "pc", "label": "PC-EVERY"},
            "lab.topology.connect": {"a": "PC-EVERY", "b": "sw1"},
            "lab.device.inspect": {"device_id": "sw1"},
            "lab.device.run_command": {"device_id": "sw1", "command": "show version"},
            "integrations.email.send": {"to": "noc@neonharbor.example", "subject": "every", "body": "x"},
            "integrations.meraki.update_config": {"serial": "Q2FK-LAB-SW1", "changes": {"access_vlan": 20}},
            "integrations.salesforce.query": {"soql": "SELECT CaseNumber FROM Case"},
            "integrations.salesforce.create_case": {"subject": "every"},
            "integrations.ipam.allocate": {"subnet": "sn-hq-users", "hostname": "every"},
        }
        for name in TOOL_NAMES:
            with self.subTest(tool=name):
                r = run(call(name, args.get(name, {})))
                self.assertIsInstance(r, dict)
                self.assertNotIn("unknown", json.dumps(r).lower()[:200])
                self.assertTrue(r.get("ok") or r.get("status") == "confirmation_required", r)


if __name__ == "__main__":
    unittest.main(verbosity=2)
