"""
V1 MCP Server Skeleton
FastMCP-style tool surface for the lab + simulated integrations.
Run with: python server.py
"""

from typing import Any
import json
from pathlib import Path

# Simulated lab state (in-memory for V1)
LAB_STATE = {
    "nodes": [],
    "edges": [],
    "integrations": {
        "email": {"messages": []},
        "meraki": {"networks": [{"id": "L_1", "name": "Lab-Net"}]},
        "monitoring": {"alerts": []},
        "salesforce": {"cases": []},
        "ipam": {"subnets": [{"cidr": "10.0.0.0/24", "free": 200}]}
    }
}

def tool_list() -> list[dict]:
    """Return the discoverable tool hierarchy."""
    return [
        {"name": "lab.topology.get", "description": "Get current topology"},
        {"name": "lab.topology.add_node", "description": "Add a node"},
        {"name": "lab.topology.connect", "description": "Connect two nodes"},
        {"name": "lab.device.list", "description": "List devices"},
        {"name": "lab.device.inspect", "description": "Inspect a device"},
        {"name": "lab.device.run_command", "description": "Run a command on a device"},
        {"name": "integrations.email.list", "description": "List email messages"},
        {"name": "integrations.email.send", "description": "Send an email"},
        {"name": "integrations.meraki.get_networks", "description": "List Meraki networks"},
        {"name": "integrations.meraki.get_devices", "description": "List Meraki devices"},
        {"name": "integrations.monitoring.get_alerts", "description": "Get monitoring alerts"},
        {"name": "integrations.salesforce.query", "description": "Query Salesforce"},
        {"name": "integrations.salesforce.create_case", "description": "Create a Salesforce case"},
        {"name": "integrations.ipam.get_subnets", "description": "List IPAM subnets"},
        {"name": "integrations.ipam.allocate", "description": "Allocate an IP"},
    ]

def handle_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Simple dispatcher for V1 tools."""
    if name == "lab.topology.get":
        return {"nodes": LAB_STATE["nodes"], "edges": LAB_STATE["edges"]}
    if name == "lab.topology.add_node":
        node = {"id": args.get("id"), "label": args.get("label"), "type": args.get("type", "computer")}
        LAB_STATE["nodes"].append(node)
        return {"ok": True, "node": node}
    if name == "lab.device.list":
        return {"devices": LAB_STATE["nodes"]}
    if name == "integrations.email.list":
        return {"messages": LAB_STATE["integrations"]["email"]["messages"]}
    if name == "integrations.email.send":
        msg = {"to": args.get("to"), "subject": args.get("subject"), "body": args.get("body")}
        LAB_STATE["integrations"]["email"]["messages"].append(msg)
        return {"ok": True, "message": msg}
    if name == "integrations.meraki.get_networks":
        return {"networks": LAB_STATE["integrations"]["meraki"]["networks"]}
    if name == "integrations.monitoring.get_alerts":
        return {"alerts": LAB_STATE["integrations"]["monitoring"]["alerts"]}
    if name == "integrations.salesforce.query":
        return {"results": LAB_STATE["integrations"]["salesforce"]["cases"]}
    if name == "integrations.ipam.get_subnets":
        return {"subnets": LAB_STATE["integrations"]["ipam"]["subnets"]}
    return {"error": f"Unknown tool: {name}"}

if __name__ == "__main__":
    print("V1 MCP Server skeleton")
    print(json.dumps(tool_list(), indent=2))
    print("\nExample call:")
    print(handle_tool("lab.topology.add_node", {"id": "pc1", "label": "PC-01", "type": "computer"}))
    print(handle_tool("lab.topology.get", {}))
