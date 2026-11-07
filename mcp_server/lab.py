"""Agent0067 lab core: shared state + the 15 tool implementations.

Pure Python, no MCP imports, so it can be unit-tested directly and wrapped
by server.py. The browser game ships a line-for-line JavaScript mirror of
this file (visual/js/tools.js); tests/test_parity.py keeps them in sync.

Everything here is FAKE: fictional org, private 10.67.0.0/16 addresses,
reserved .example domains, and API keys that must start with "FAKE-".
Nothing in this module opens a socket or calls a real service.
"""
from __future__ import annotations

import copy
import ipaddress
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "lab_state" / "seed.json"
STATE_PATH = ROOT / "lab_state" / "state.json"
_DEFAULT = object()


def state_path() -> Path:
    """Resolved when a store is created, so AGENT0067_STATE set after import still counts."""
    return Path(os.environ.get("AGENT0067_STATE") or STATE_PATH)

NODE_TYPES = ("pc", "switch", "router", "server", "firewall", "cloud")
TYPE_PREFIX = {"pc": "pc", "switch": "sw", "router": "rtr", "server": "srv", "firewall": "fw", "cloud": "cld"}
TYPE_LABEL = {"pc": "PC", "switch": "SW", "router": "RTR", "server": "SRV", "firewall": "FW", "cloud": "CLOUD"}
MAX_LINKS = {"pc": 1, "server": 2, "switch": 8, "router": 8, "firewall": 8, "cloud": 8}
# which simulated system may attach to which device type (judgment, not just rules)
ATTACH_RULES = {
    "meraki": ("switch", "router", "firewall"),
    "monitoring": ("pc", "switch", "router", "server", "firewall"),
    "ipam": ("pc", "switch", "router", "server", "firewall"),
    "email": ("server",),
    "salesforce": ("cloud",),
}
SYSTEMS = ("email", "meraki", "monitoring", "salesforce", "ipam")
KEY_ENV = {
    "email": "EMAIL_API_KEY",
    "meraki": "MERAKI_API_KEY",
    "monitoring": "MONITORING_API_KEY",
    "salesforce": "SALESFORCE_API_KEY",
    "ipam": "IPAM_API_KEY",
}
KEY_RE = re.compile(r"^FAKE-[A-Z]+-[0-9a-f]{32}$")
MERAKI_MODEL = {"switch": "MS120-8 (sim)", "router": "MX67 (sim)", "firewall": "MX68 (sim)"}
VERIFY_KEYS = ("ping", "alert", "case", "allocate", "config")

TOOL_NAMES = (
    "lab.topology.get",
    "lab.topology.add_node",
    "lab.topology.connect",
    "lab.device.list",
    "lab.device.inspect",
    "lab.device.run_command",
    "integrations.email.list",
    "integrations.email.send",
    "integrations.meraki.get_networks",
    "integrations.meraki.get_devices",
    "integrations.meraki.update_config",
    "integrations.monitoring.get_alerts",
    "integrations.monitoring.get_metrics",
    "integrations.salesforce.query",
    "integrations.salesforce.create_case",
    "integrations.ipam.get_subnets",
    "integrations.ipam.allocate",
)
# NOTE: the V1 brief calls this "all 15 tools", but its own list names 17
# (6 lab + 11 integration). All 17 are implemented.


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def mask_key(value: str | None) -> str:
    if not value:
        return "(unset)"
    return "..." + value[-4:]


def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def err(code: str, message: str, **extra: Any) -> dict:
    out = {"ok": False, "error": code, "message": message}
    out.update(extra)
    return out


# ---------------------------------------------------------------- the store
class LabStore:
    """File-backed state shared by every process that touches the lab.

    The stdio MCP server (used by an AI client), the HTTP server (used by the
    browser bridge) and the tests all read and write lab_state/state.json.
    The file is re-read whenever its mtime changes, and written atomically.
    """

    def __init__(self, path: Path | None = _DEFAULT, seed_path: Path = SEED_PATH):  # type: ignore[assignment]
        self.path = state_path() if path is _DEFAULT else path
        self.seed_path = seed_path
        self._mtime = None
        self.state: dict = {}
        self.load()

    def seed(self) -> dict:
        return json.loads(self.seed_path.read_text(encoding="utf-8"))

    def load(self) -> dict:
        if self.path and self.path.exists():
            try:
                self.state = json.loads(self.path.read_text(encoding="utf-8"))
                self._mtime = self.path.stat().st_mtime_ns
                return self.state
            except (OSError, json.JSONDecodeError):
                pass
        self.state = self.seed()
        self.save(bump=False)
        return self.state

    def refresh(self) -> dict:
        if self.path and self.path.exists():
            m = self.path.stat().st_mtime_ns
            if m != self._mtime:
                return self.load()
        return self.state

    def save(self, bump: bool = True) -> None:
        if bump:
            self.state["rev"] = int(self.state.get("rev", 0)) + 1
            self.state["updated_at"] = utcnow()
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".state-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.state, f, indent=2)
        for _ in range(5):
            try:
                os.replace(tmp, self.path)
                break
            except PermissionError:  # Windows: reader has the file open briefly
                time.sleep(0.05)
        self._mtime = self.path.stat().st_mtime_ns

    def replace(self, new_state: dict) -> dict:
        """Used by the browser bridge: accept a full state pushed from the canvas."""
        if not isinstance(new_state, dict) or "nodes" not in new_state or "integrations" not in new_state:
            raise ValueError("not a lab state document")
        rev = max(int(self.state.get("rev", 0)), int(new_state.get("rev", 0)))
        self.state = new_state
        self.state["rev"] = rev
        self.save()
        return self.state

    def reset(self) -> dict:
        self.state = self.seed()
        self.save()
        return self.state


# ---------------------------------------------------------------- the lab
class Lab:
    def __init__(self, store: LabStore, env: Mapping[str, str] | None = None,
                 clock: Callable[[], str] = utcnow):
        self.store = store
        self.env = env if env is not None else os.environ
        self.clock = clock

    # -- helpers ---------------------------------------------------------
    @property
    def s(self) -> dict:
        return self.store.state

    def _begin(self) -> dict:
        return self.store.refresh()

    def _commit(self) -> None:
        self.store.save()

    def _node(self, ref: str) -> dict | None:
        if not ref:
            return None
        ref_l = str(ref).lower()
        for n in self.s["nodes"]:
            if n["id"].lower() == ref_l or n["label"].lower() == ref_l or n["config"].get("hostname", "").lower() == ref_l:
                return n
        return None

    def _neighbors(self, node_id: str) -> list[str]:
        out = []
        for e in self.s["edges"]:
            if e["a"] == node_id:
                out.append(e["b"])
            elif e["b"] == node_id:
                out.append(e["a"])
        return out

    def _event(self, kind: str, detail: dict) -> None:
        c = self.s["counters"]
        c["event"] = c.get("event", 0) + 1
        self.s.setdefault("events", []).append({"id": c["event"], "kind": kind, "at": self.clock(), **detail})
        self.s["events"] = self.s["events"][-50:]

    def _verify(self, key: str, passed: bool, detail: str) -> None:
        self.s.setdefault("verification", {})[key] = {
            "status": "pass" if passed else "fail", "detail": detail, "at": self.clock(),
        }

    def auth(self, system: str) -> dict:
        """Keys live on the SERVER (env / .env). The model never sees them."""
        env_name = KEY_ENV[system]
        value = self.env.get(env_name, "")
        if not value:
            return err("missing_api_key", f"{env_name} is not set on the MCP server.", env=env_name,
                       hint=f"Generate a FAKE key in the {system} settings panel, then `export {env_name}=...` "
                            "or add it to .env. Never paste it into a chat or prompt.")
        if not KEY_RE.match(value):
            return err("rejected_api_key", f"{env_name} does not look like a lab key. This lab only accepts "
                       "FAKE-<SYSTEM>-<32 hex> keys; a real key must never be used here.", env=env_name)
        return {"ok": True, "env": env_name, "key": mask_key(value)}

    def _gate(self, system: str) -> dict | None:
        a = self.auth(system)
        return None if a["ok"] else a

    @staticmethod
    def _confirm_needed(tool: str, preview: dict) -> dict:
        return {
            "ok": False, "status": "confirmation_required", "tool": tool, "preview": preview,
            "message": "This is a write. Show the preview to the user and re-call with confirm=true only after they approve.",
        }

    def _meraki_devices(self) -> list[dict]:
        devs = [copy.deepcopy(d) for d in self.s["integrations"]["meraki"]["devices"]]
        for n in self.s["nodes"]:
            if "meraki" in n.get("integrations", []):
                devs.append({
                    "serial": n["meraki_serial"], "name": n["label"], "model": MERAKI_MODEL.get(n["type"], "sim"),
                    "network_id": "N_FAKE_HQ", "status": "online" if n.get("status", "up") == "up" else "offline",
                    "lan_ip": n["config"].get("mgmt_ip") or "", "last_seen": self.clock(),
                    "config": {k: n["config"].get(k) for k in ("access_vlan", "uplink_enabled", "notes")},
                    "lab_node": n["id"],
                })
        return devs

    def _metrics_for(self, name: str, status: str) -> dict:
        h = fnv1a(name)
        if status in ("offline", "down"):
            return {"reachable": False, "cpu_pct": None, "mem_pct": None, "latency_ms": None, "if_util_pct": None}
        return {
            "reachable": True,
            "cpu_pct": 6 + h % 55,
            "mem_pct": 28 + (h >> 8) % 52,
            "latency_ms": 1 + (h >> 16) % 24,
            "if_util_pct": (h >> 4) % 71,
        }

    # -- lab/topology -----------------------------------------------------
    def topology_get(self) -> dict:
        self._begin()
        return {
            "ok": True,
            "rev": self.s.get("rev", 0),
            "nodes": [{k: n[k] for k in ("id", "label", "type", "x", "y", "status", "integrations")} for n in self.s["nodes"]],
            "edges": [{"a": e["a"], "b": e["b"], "a_port": e["a_port"], "b_port": e["b_port"]} for e in self.s["edges"]],
            "counts": {"nodes": len(self.s["nodes"]), "edges": len(self.s["edges"])},
        }

    def topology_add_node(self, type: str, label: str | None = None, x: float | None = None,
                          y: float | None = None, integrations: list[str] | None = None) -> dict:
        self._begin()
        t = str(type or "").lower()
        if t not in NODE_TYPES:
            return err("bad_type", f"Unknown device type '{type}'.", allowed=list(NODE_TYPES))
        c = self.s["counters"]
        c[t] = c.get(t, 0) + 1
        n = c[t]
        node_id = f"{TYPE_PREFIX[t]}{n}"
        while self._node(node_id):
            c[t] += 1
            n = c[t]
            node_id = f"{TYPE_PREFIX[t]}{n}"
        lbl = (label or f"{TYPE_LABEL[t]}-{n:02d}").strip()[:24]
        if self._node(lbl):
            return err("duplicate_label", f"A node named '{lbl}' already exists.")
        count = len(self.s["nodes"])
        node = {
            "id": node_id, "label": lbl, "type": t,
            "x": float(x) if x is not None else 140.0 + (count % 4) * 170.0,
            "y": float(y) if y is not None else 120.0 + (count // 4) * 140.0,
            "status": "up", "integrations": [],
            "meraki_serial": f"Q2FK-LAB-{node_id.upper()}",
            "config": {"hostname": lbl, "mgmt_ip": "", "access_vlan": 1, "uplink_enabled": True,
                       "notes": "", "interfaces": [], "config_rev": 0},
        }
        self.s["nodes"].append(node)
        warnings = []
        for sysname in integrations or []:
            r = self._attach(node, sysname)
            if not r["ok"]:
                warnings.append(r["message"])
        self._event("node_added", {"node": node_id})
        self._commit()
        out = {"ok": True, "node": copy.deepcopy(node)}
        if warnings:
            out["warnings"] = warnings
        return out

    def _attach(self, node: dict, system: str) -> dict:
        system = str(system).lower()
        if system not in SYSTEMS:
            return err("bad_system", f"Unknown system '{system}'.", allowed=list(SYSTEMS))
        if node["type"] not in ATTACH_RULES[system]:
            return err("bad_attach", f"{system} does not belong on a {node['type']}. "
                       f"It fits: {', '.join(ATTACH_RULES[system])}.")
        if system not in node["integrations"]:
            node["integrations"].append(system)
        return {"ok": True}

    def attach(self, node_ref: str, system: str) -> dict:
        """Lab action used by the canvas (not one of the MCP tools)."""
        self._begin()
        node = self._node(node_ref)
        if not node:
            return err("not_found", f"No device '{node_ref}'.")
        r = self._attach(node, system)
        if r["ok"]:
            self._commit()
        return r

    def _next_port(self, node: dict) -> str:
        used = {i["name"] for i in node["config"]["interfaces"]}
        t = node["type"]
        for k in range(1, 33):
            name = {"pc": f"eth{k-1}", "server": f"eth{k-1}", "cloud": f"wan{k-1}",
                    "firewall": f"port{k}"}.get(t, f"Gi0/{k}")
            if name not in used:
                return name
        return f"x{len(used)}"

    def topology_connect(self, a: str, b: str) -> dict:
        self._begin()
        na, nb = self._node(a), self._node(b)
        if not na or not nb:
            return err("not_found", f"Both ends must exist (got '{a}', '{b}').")
        if na["id"] == nb["id"]:
            return err("self_link", "A device cannot be cabled to itself.")
        for e in self.s["edges"]:
            if {e["a"], e["b"]} == {na["id"], nb["id"]}:
                return err("duplicate_link", f"{na['label']} and {nb['label']} are already connected.")
        for n in (na, nb):
            if len(self._neighbors(n["id"])) >= MAX_LINKS[n["type"]]:
                return err("no_free_port", f"{n['label']} ({n['type']}) has no free port "
                           f"(max {MAX_LINKS[n['type']]}). Put a switch between them.")
        pa, pb = self._next_port(na), self._next_port(nb)
        na["config"]["interfaces"].append({"name": pa, "peer": nb["id"], "ip": "", "status": "up"})
        nb["config"]["interfaces"].append({"name": pb, "peer": na["id"], "ip": "", "status": "up"})
        edge = {"id": f"{na['id']}--{nb['id']}", "a": na["id"], "b": nb["id"], "a_port": pa, "b_port": pb}
        self.s["edges"].append(edge)
        self._event("link_added", {"edge": edge["id"]})
        self._commit()
        return {"ok": True, "edge": edge}

    # -- lab/device -------------------------------------------------------
    def device_list(self) -> dict:
        self._begin()
        devices = []
        for n in self.s["nodes"]:
            devices.append({
                "id": n["id"], "label": n["label"], "type": n["type"], "status": n.get("status", "up"),
                "mgmt_ip": n["config"].get("mgmt_ip", ""), "links": len(self._neighbors(n["id"])),
                "integrations": list(n.get("integrations", [])),
            })
        return {"ok": True, "devices": devices, "count": len(devices)}

    def device_inspect(self, device_id: str) -> dict:
        self._begin()
        n = self._node(device_id)
        if not n:
            return err("not_found", f"No device '{device_id}'.", known=[x["id"] for x in self.s["nodes"]])
        alloc = []
        for sn in self.s["integrations"]["ipam"]["subnets"]:
            for a in sn["allocations"]:
                if a.get("node") == n["id"]:
                    alloc.append({"subnet": sn["id"], **a})
        alerts = [a for a in self.s["integrations"]["monitoring"]["alerts"] if a["source"] == n["label"]]
        return {
            "ok": True,
            "device": copy.deepcopy(n),
            "neighbors": [{"id": x, "label": self._node(x)["label"]} for x in self._neighbors(n["id"])],
            "metrics": self._metrics_for(n["label"], n.get("status", "up")),
            "ipam": alloc,
            "alerts": alerts,
        }

    def _path(self, src: str, dst: str) -> list[str] | None:
        prev = {src: None}
        queue = [src]
        while queue:
            cur = queue.pop(0)
            if cur == dst:
                path = []
                while cur is not None:
                    path.append(cur)
                    cur = prev[cur]
                return path[::-1]
            for nb in self._neighbors(cur):
                if nb not in prev and self._node(nb).get("status", "up") == "up":
                    prev[nb] = cur
                    queue.append(nb)
        return None

    def device_run_command(self, device_id: str, command: str) -> dict:
        self._begin()
        n = self._node(device_id)
        if not n:
            return err("not_found", f"No device '{device_id}'.")
        cmd = " ".join(str(command or "").strip().split())
        low = cmd.lower()
        cfg = n["config"]
        host = cfg.get("hostname") or n["label"]
        lines: list[str]
        if low in ("show version", "sh ver"):
            lines = [f"{host} — Agent0067 SimOS 6.7 (FAKE)", f"Device type: {n['type']}", "Uptime: 6 days, 7 hours",
                     f"Config revision: {cfg.get('config_rev', 0)}"]
        elif low in ("show running-config", "sh run", "show run"):
            lines = [f"hostname {host}"]
            for i in cfg["interfaces"]:
                lines += [f"interface {i['name']}", f" description link to {i['peer']}"]
                if i.get("ip"):
                    lines.append(f" ip address {i['ip']}")
                lines.append(" no shutdown" if i["status"] == "up" else " shutdown")
            if cfg.get("mgmt_ip"):
                lines.append(f"ip mgmt {cfg['mgmt_ip']}")
            lines.append(f"switchport access vlan {cfg.get('access_vlan', 1)}")
            if cfg.get("notes"):
                lines.append(f"! notes: {cfg['notes']}")
            lines.append("end")
        elif low in ("show ip interface brief", "sh ip int br", "show ip int brief"):
            lines = ["Interface        IP-Address       Status   Peer"]
            for i in cfg["interfaces"]:
                lines.append(f"{i['name']:<16} {i.get('ip') or 'unassigned':<16} {i['status']:<8} {i['peer']}")
            if cfg.get("mgmt_ip"):
                lines.append(f"{'mgmt0':<16} {cfg['mgmt_ip']:<16} {'up':<8} -")
        elif low in ("show cdp neighbors", "show lldp neighbors", "sh cdp nei", "sh lldp nei"):
            lines = ["Device-ID        Local-Port   Remote-Port"]
            for e in self.s["edges"]:
                if e["a"] == n["id"]:
                    lines.append(f"{self._node(e['b'])['label']:<16} {e['a_port']:<12} {e['b_port']}")
                elif e["b"] == n["id"]:
                    lines.append(f"{self._node(e['a'])['label']:<16} {e['b_port']:<12} {e['a_port']}")
        elif low.startswith("ping ") or low.startswith("traceroute "):
            target_ref = cmd.split(" ", 1)[1]
            target = self._node(target_ref)
            if not target:
                for x in self.s["nodes"]:
                    if x["config"].get("mgmt_ip") and x["config"]["mgmt_ip"] == target_ref:
                        target = x
            if not target:
                self._verify("ping", False, f"{host}: unknown target {target_ref}")
                self._commit()
                return err("unknown_target", f"% Unrecognized host or address: {target_ref}")
            path = self._path(n["id"], target["id"])
            ok = path is not None
            hops = [self._node(p)["label"] for p in path] if path else []
            if low.startswith("ping"):
                lines = [f"Sending 5, 100-byte ICMP Echos to {target['label']}, timeout is 2 seconds:",
                         "!!!!!" if ok else ".....",
                         f"Success rate is {'100 percent (5/5)' if ok else '0 percent (0/5)'}"]
                if ok:
                    lines.append("path: " + " -> ".join(hops))
                self._verify("ping", ok, f"{n['label']} -> {target['label']}: " + (" -> ".join(hops) if ok else "no path"))
            else:
                lines = [f"traceroute to {target['label']}"] + (
                    [f" {i + 1}  {h}  {1 + i * 2} ms" for i, h in enumerate(hops[1:])] if ok else [" 1  * * *"])
            self._commit()
            return {"ok": True, "device": n["id"], "command": cmd, "output": lines, "success": ok, "path": hops}
        elif low in ("send test-trap", "test trap", "send test trap"):
            c = self.s["counters"]
            c["alert"] += 1
            alert = {"id": f"AL-{c['alert']}", "severity": "warning", "source": n["label"], "site": "HQ",
                     "message": f"TEST-TRAP from {host} (lab verification)", "status": "open", "at": self.clock()}
            self.s["integrations"]["monitoring"]["alerts"].append(alert)
            self._verify("alert", True, f"{alert['id']} raised by {n['label']}")
            self._event("alert", {"alert": alert["id"]})
            self._commit()
            return {"ok": True, "device": n["id"], "command": cmd,
                    "output": [f"SNMP trap sent to monitoring collector: {alert['id']}"], "alert": alert}
        else:
            return err("invalid_input", f"% Invalid input detected: '{cmd}'", supported=[
                "show version", "show running-config", "show ip interface brief", "show cdp neighbors",
                "ping <device>", "traceroute <device>", "send test-trap"])
        return {"ok": True, "device": n["id"], "command": cmd, "output": lines}

    # -- integrations/email ------------------------------------------------
    def email_list(self, folder: str = "inbox", limit: int = 20, unread_only: bool = False) -> dict:
        self._begin()
        g = self._gate("email")
        if g:
            return g
        msgs = [m for m in self.s["integrations"]["email"]["messages"]
                if (folder == "all" or m["folder"] == folder) and (not unread_only or not m.get("read"))]
        msgs = sorted(msgs, key=lambda m: m["at"], reverse=True)[: max(1, min(int(limit), 100))]
        return {"ok": True, "auth": self.auth("email"), "mailbox": self.s["integrations"]["email"]["mailbox"],
                "folder": folder, "messages": copy.deepcopy(msgs), "count": len(msgs)}

    def email_send(self, to: str, subject: str, body: str, confirm: bool = False) -> dict:
        self._begin()
        g = self._gate("email")
        if g:
            return g
        to = str(to or "").strip()
        if not re.match(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.example$", to):
            return err("bad_recipient", "The simulated mail relay only delivers to *.example addresses.")
        if not subject:
            return err("bad_subject", "Subject is required.")
        box = self.s["integrations"]["email"]["mailbox"]
        preview = {"from": box, "to": to, "subject": subject, "body": body}
        if not confirm:
            return self._confirm_needed("integrations.email.send", preview)
        c = self.s["counters"]
        c["msg"] += 1
        msg = {"id": f"msg-{c['msg']}", "folder": "sent", "read": True, "at": self.clock(), **preview}
        self.s["integrations"]["email"]["messages"].append(msg)
        if to.lower() == box.lower():
            c["msg"] += 1
            self.s["integrations"]["email"]["messages"].append({**msg, "id": f"msg-{c['msg']}", "folder": "inbox", "read": False})
        self._event("email_sent", {"msg": msg["id"]})
        self._commit()
        return {"ok": True, "auth": self.auth("email"), "message": msg}

    # -- integrations/meraki ----------------------------------------------
    def meraki_get_networks(self) -> dict:
        self._begin()
        g = self._gate("meraki")
        if g:
            return g
        devs = self._meraki_devices()
        nets = []
        for net in self.s["integrations"]["meraki"]["networks"]:
            mine = [d for d in devs if d["network_id"] == net["id"]]
            off = sum(1 for d in mine if d["status"] == "offline")
            alerting = sum(1 for d in mine if d["status"] == "alerting")
            if not mine:
                status = "empty"
            elif off == len(mine):
                status = "down"
            elif off or alerting:
                status = "degraded"
            else:
                status = "up"
            nets.append({**net, "status": status, "devices": len(mine), "offline": off, "alerting": alerting})
        return {"ok": True, "auth": self.auth("meraki"), "org": self.s["integrations"]["meraki"]["org"], "networks": nets}

    def meraki_get_devices(self, network_id: str | None = None, status: str | None = None) -> dict:
        self._begin()
        g = self._gate("meraki")
        if g:
            return g
        devs = self._meraki_devices()
        if network_id:
            devs = [d for d in devs if d["network_id"] == network_id or
                    any(n["id"] == d["network_id"] and n["name"].lower() == network_id.lower()
                        for n in self.s["integrations"]["meraki"]["networks"])]
        if status:
            devs = [d for d in devs if d["status"] == status]
        return {"ok": True, "auth": self.auth("meraki"), "devices": devs, "count": len(devs)}

    def meraki_update_config(self, serial: str, changes: dict, confirm: bool = False) -> dict:
        self._begin()
        g = self._gate("meraki")
        if g:
            return g
        allowed = {"name": str, "access_vlan": int, "uplink_enabled": bool, "notes": str}
        if not isinstance(changes, dict) or not changes:
            return err("bad_changes", "changes must be a non-empty object.", allowed=list(allowed))
        bad = [k for k in changes if k not in allowed]
        if bad:
            return err("bad_changes", f"Unsupported setting(s): {', '.join(bad)}.", allowed=list(allowed))
        if "access_vlan" in changes:
            try:
                v = int(changes["access_vlan"])
            except (TypeError, ValueError):
                return err("bad_vlan", "access_vlan must be an integer 1-4094.")
            if not 1 <= v <= 4094:
                return err("bad_vlan", "access_vlan must be 1-4094.")
            changes = {**changes, "access_vlan": v}
        node = next((n for n in self.s["nodes"] if n.get("meraki_serial") == serial and "meraki" in n["integrations"]), None)
        seeded = next((d for d in self.s["integrations"]["meraki"]["devices"] if d["serial"] == serial), None)
        if not node and not seeded:
            return err("not_found", f"No Meraki device with serial {serial}.")
        before = ({"name": node["label"], **{k: node["config"].get(k) for k in ("access_vlan", "uplink_enabled", "notes")}}
                  if node else {"name": seeded["name"], **seeded["config"]})
        after = {**before, **changes}
        if not confirm:
            return self._confirm_needed("integrations.meraki.update_config",
                                        {"serial": serial, "before": before, "after": after})
        if node:
            if "name" in changes:
                node["label"] = str(changes["name"])[:24]
                node["config"]["hostname"] = node["label"]
            for k in ("access_vlan", "uplink_enabled", "notes"):
                if k in changes:
                    node["config"][k] = changes[k]
            node["config"]["config_rev"] = node["config"].get("config_rev", 0) + 1
            applied = node["config"].get("access_vlan") == after["access_vlan"] and node["label"] == after["name"]
            self._verify("config", applied, f"{serial} -> {node['label']} rev {node['config']['config_rev']}")
        else:
            if "name" in changes:
                seeded["name"] = str(changes["name"])[:24]
            for k in ("access_vlan", "uplink_enabled", "notes"):
                if k in changes:
                    seeded["config"][k] = changes[k]
            self._verify("config", True, f"{serial} ({seeded['name']}) updated")
        self._event("config_push", {"serial": serial})
        self._commit()
        return {"ok": True, "auth": self.auth("meraki"), "serial": serial, "before": before, "after": after,
                "lab_node": node["id"] if node else None}

    # -- integrations/monitoring --------------------------------------------
    def monitoring_get_alerts(self, severity: str | None = None, status: str = "open", site: str | None = None) -> dict:
        self._begin()
        g = self._gate("monitoring")
        if g:
            return g
        alerts = self.s["integrations"]["monitoring"]["alerts"]
        out = [a for a in alerts if (status == "all" or a["status"] == status)
               and (not severity or a["severity"] == severity) and (not site or a["site"].lower() == site.lower())]
        return {"ok": True, "auth": self.auth("monitoring"), "alerts": copy.deepcopy(out[::-1]), "count": len(out)}

    def monitoring_get_metrics(self, device: str | None = None) -> dict:
        self._begin()
        g = self._gate("monitoring")
        if g:
            return g
        rows = []
        for n in self.s["nodes"]:
            if "monitoring" in n["integrations"]:
                rows.append({"device": n["label"], "source": "lab", **self._metrics_for(n["label"], n.get("status", "up"))})
        for d in self.s["integrations"]["meraki"]["devices"]:
            rows.append({"device": d["name"], "source": "branch", **self._metrics_for(d["name"], d["status"])})
        if device:
            rows = [r for r in rows if r["device"].lower() == device.lower() or
                    (self._node(device) and self._node(device)["label"] == r["device"])]
            if not rows:
                return err("not_monitored", f"'{device}' is not monitored. Attach monitoring to it on the canvas first.")
        return {"ok": True, "auth": self.auth("monitoring"), "metrics": rows, "count": len(rows)}

    # -- integrations/salesforce -------------------------------------------
    SOQL = re.compile(
        r"^\s*SELECT\s+(?P<fields>.+?)\s+FROM\s+(?P<obj>\w+)"
        r"(?:\s+WHERE\s+(?P<where>.+?))?"
        r"(?:\s+ORDER\s+BY\s+(?P<order>\w+)(?:\s+(?P<dir>ASC|DESC))?)?"
        r"(?:\s+LIMIT\s+(?P<limit>\d+))?\s*$", re.I)
    COND = re.compile(r"^\s*(\w+)\s*(=|!=|LIKE)\s*'([^']*)'\s*$", re.I)

    def salesforce_query(self, soql: str) -> dict:
        self._begin()
        g = self._gate("salesforce")
        if g:
            return g
        m = self.SOQL.match(soql or "")
        if not m:
            return err("malformed_query", "Expected: SELECT f1, f2 FROM Case|Account [WHERE f = 'v' [AND ...]] "
                       "[ORDER BY f [ASC|DESC]] [LIMIT n]")
        obj = m["obj"].lower()
        table = {"case": "cases", "account": "accounts"}.get(obj)
        if not table:
            return err("bad_object", f"sObject type '{m['obj']}' is not supported.", supported=["Case", "Account"])
        rows = self.s["integrations"]["salesforce"][table]
        known = set(rows[0].keys()) if rows else set()
        fields = [f.strip() for f in m["fields"].split(",")]
        if fields == ["*"] or [f.upper() for f in fields] == ["FIELDS(ALL)"]:
            fields = sorted(known)
        bad = [f for f in fields if f not in known]
        if bad:
            return err("invalid_field", f"No such column(s) on {m['obj']}: {', '.join(bad)}", known=sorted(known))
        conds = []
        if m["where"]:
            for part in re.split(r"\s+AND\s+", m["where"], flags=re.I):
                c = self.COND.match(part)
                if not c or c[1] not in known:
                    return err("malformed_where", f"Cannot parse condition: {part.strip()}")
                conds.append((c[1], c[2].upper(), c[3]))

        def keep(r: dict) -> bool:
            for f, op, v in conds:
                val = str(r.get(f, ""))
                if op == "=" and val != v:
                    return False
                if op == "!=" and val == v:
                    return False
                if op == "LIKE":
                    rx = "^" + re.escape(v).replace("%", ".*").replace("_", ".") + "$"
                    if not re.match(rx, val, re.I):
                        return False
            return True

        out = [r for r in rows if keep(r)]
        if m["order"]:
            if m["order"] not in known:
                return err("invalid_field", f"Cannot order by {m['order']}")
            out = sorted(out, key=lambda r: str(r.get(m["order"], "")), reverse=(m["dir"] or "").upper() == "DESC")
        if m["limit"]:
            out = out[: int(m["limit"])]
        return {"ok": True, "auth": self.auth("salesforce"), "totalSize": len(out),
                "records": [{f: r.get(f) for f in fields} for r in out]}

    def salesforce_create_case(self, subject: str, description: str = "", priority: str = "Medium",
                               account: str | None = None, device: str | None = None, confirm: bool = False) -> dict:
        self._begin()
        g = self._gate("salesforce")
        if g:
            return g
        if not subject:
            return err("bad_subject", "Subject is required.")
        if priority not in ("Low", "Medium", "High", "Critical"):
            return err("bad_priority", "priority must be Low, Medium, High or Critical.")
        acct = None
        if account:
            acct = next((a for a in self.s["integrations"]["salesforce"]["accounts"]
                         if account.lower() in (a["Id"].lower(), a["Name"].lower(), a["Site"].lower())), None)
            if not acct:
                return err("bad_account", f"No account matching '{account}'.")
        preview = {"Subject": subject, "Description": description, "Priority": priority,
                   "AccountId": acct["Id"] if acct else "", "Device": device or ""}
        if not confirm:
            return self._confirm_needed("integrations.salesforce.create_case", preview)
        c = self.s["counters"]
        c["case"] += 1
        num = f"{c['case']:08d}"
        case = {"Id": f"500FAKE{num[-8:]:0>8}", "CaseNumber": num, "Status": "New", "CreatedDate": self.clock(), **preview}
        self.s["integrations"]["salesforce"]["cases"].append(case)
        self._verify("case", True, f"Case {num} created")
        self._event("case", {"case": num})
        self._commit()
        return {"ok": True, "auth": self.auth("salesforce"), "case": case}

    # -- integrations/ipam ---------------------------------------------------
    def _subnet_view(self, sn: dict) -> dict:
        net = ipaddress.ip_network(sn["cidr"])
        usable = max(0, net.num_addresses - 2)
        used = len(sn["allocations"])
        return {**copy.deepcopy(sn), "usable": usable, "used": used, "free": usable - used}

    def ipam_get_subnets(self, site: str | None = None) -> dict:
        self._begin()
        g = self._gate("ipam")
        if g:
            return g
        subs = [self._subnet_view(sn) for sn in self.s["integrations"]["ipam"]["subnets"]
                if not site or sn["site"].lower() == site.lower()]
        return {"ok": True, "auth": self.auth("ipam"), "subnets": subs, "count": len(subs)}

    def ipam_allocate(self, subnet: str, hostname: str, node_id: str | None = None, confirm: bool = False) -> dict:
        self._begin()
        g = self._gate("ipam")
        if g:
            return g
        sn = next((x for x in self.s["integrations"]["ipam"]["subnets"] if subnet in (x["id"], x["cidr"])), None)
        if not sn:
            return err("not_found", f"No subnet '{subnet}'.",
                       known=[x["id"] for x in self.s["integrations"]["ipam"]["subnets"]])
        hostname = str(hostname or "").strip().lower()
        if not re.match(r"^[a-z0-9][a-z0-9-]{0,30}$", hostname):
            return err("bad_hostname", "hostname must be 1-31 chars: letters, digits, dashes.")
        if any(a["hostname"] == hostname for a in sn["allocations"]):
            return err("duplicate_hostname", f"{hostname} already has an address in {sn['cidr']}.")
        node = None
        if node_id:
            node = self._node(node_id)
            if not node:
                return err("not_found", f"No device '{node_id}' to bind the address to.")
        net = ipaddress.ip_network(sn["cidr"])
        used = {a["ip"] for a in sn["allocations"]}
        hosts = list(net.hosts())
        start = 9 if net.num_addresses > 64 else 2  # keep the bottom of big subnets for infra
        ip = next((str(h) for h in hosts[start:] if str(h) not in used), None)
        if not ip:
            self._verify("allocate", False, f"{sn['cidr']} is full")
            self._commit()
            return err("subnet_full", f"{sn['cidr']} has no free addresses.")
        preview = {"subnet": sn["id"], "cidr": sn["cidr"], "ip": ip, "hostname": hostname,
                   "node": node["id"] if node else None}
        if not confirm:
            return self._confirm_needed("integrations.ipam.allocate", preview)
        alloc = {"ip": ip, "hostname": hostname, "kind": "host", "at": self.clock()}
        if node:
            alloc["node"] = node["id"]
            node["config"]["mgmt_ip"] = ip
        sn["allocations"].append(alloc)
        self._verify("allocate", True, f"{ip} -> {hostname}")
        self._event("ip_allocated", {"ip": ip})
        self._commit()
        return {"ok": True, "auth": self.auth("ipam"), "allocation": {"subnet": sn["id"], **alloc},
                "subnet": self._subnet_view(sn)}

    # -- dispatcher (used by tests + the parity check) ------------------------
    def call(self, name: str, args: dict | None = None) -> dict:
        fn = {
            "lab.topology.get": self.topology_get,
            "lab.topology.add_node": self.topology_add_node,
            "lab.topology.connect": self.topology_connect,
            "lab.device.list": self.device_list,
            "lab.device.inspect": self.device_inspect,
            "lab.device.run_command": self.device_run_command,
            "integrations.email.list": self.email_list,
            "integrations.email.send": self.email_send,
            "integrations.meraki.get_networks": self.meraki_get_networks,
            "integrations.meraki.get_devices": self.meraki_get_devices,
            "integrations.meraki.update_config": self.meraki_update_config,
            "integrations.monitoring.get_alerts": self.monitoring_get_alerts,
            "integrations.monitoring.get_metrics": self.monitoring_get_metrics,
            "integrations.salesforce.query": self.salesforce_query,
            "integrations.salesforce.create_case": self.salesforce_create_case,
            "integrations.ipam.get_subnets": self.ipam_get_subnets,
            "integrations.ipam.allocate": self.ipam_allocate,
        }.get(name)
        if not fn:
            return err("unknown_tool", f"Unknown tool: {name}", known=list(TOOL_NAMES))
        return fn(**(args or {}))
