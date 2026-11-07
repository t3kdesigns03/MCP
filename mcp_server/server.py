"""Agent0067 MCP server — a real FastMCP server in front of five FAKE systems.

The model never calls an API. It discovers these tools (tools/list), picks
one, and the client app sends tools/call to this server. This server holds
the API keys (from env / .env) and does the call. Here every "API" is a
simulation backed by lab_state/state.json — no real network calls.

Run it:
    fastmcp run mcp_server/server.py              # stdio (for MCP clients)
    python mcp_server/server.py                   # stdio, same thing
    python mcp_server/server.py --http            # http://127.0.0.1:8067/mcp
                                                  # + /lab/* bridge for the game
    fastmcp list mcp_server/server.py             # discovery from the CLI
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv  # noqa: E402
from fastmcp import FastMCP  # noqa: E402
from pydantic import Field  # noqa: E402

from lab import KEY_ENV, ROOT, Lab, LabStore, mask_key  # noqa: E402

# Keys live on the server. .env is git-ignored from the first commit.
load_dotenv(ROOT / ".env")
load_dotenv()

store = LabStore()
lab = Lab(store)

mcp = FastMCP(
    name="agent0067-lab",
    version="1.0.0",
    instructions=(
        "Agent0067 network lab. All systems, data and keys are FICTIONAL. "
        "Use read-only tools first. Write tools (email.send, meraki.update_config, "
        "salesforce.create_case, ipam.allocate) return a preview; only re-call them with "
        "confirm=true after the user approves the preview."
    ),
)

READ = {"readOnlyHint": True, "openWorldHint": False}
LAB_WRITE = {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}
WRITE = {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False}

NodeType = Literal["pc", "switch", "router", "server", "firewall", "cloud"]
System = Literal["email", "meraki", "monitoring", "salesforce", "ipam"]
Confirm = Annotated[bool, Field(description="Must be true to actually write. Leave false to get a preview for the user.")]


# ------------------------------------------------------------------ lab/
@mcp.tool(name="lab.topology.get", annotations=READ, tags={"lab"})
def topology_get() -> dict[str, Any]:
    """Return the lab topology the player built on the canvas: nodes (id, label, type, position,
    status, attached systems) and cabled edges with port names."""
    return lab.topology_get()


@mcp.tool(name="lab.topology.add_node", annotations=LAB_WRITE, tags={"lab"})
def topology_add_node(
    type: Annotated[NodeType, Field(description="Device type")],
    label: Annotated[str | None, Field(description="Display name, e.g. SW-CORE")] = None,
    x: float | None = None,
    y: float | None = None,
    integrations: Annotated[list[System] | None, Field(description="Systems to attach, e.g. ['meraki','monitoring']")] = None,
) -> dict[str, Any]:
    """Place a new device on the lab map. Shows up on the canvas on the next sync."""
    return lab.topology_add_node(type, label, x, y, integrations)


@mcp.tool(name="lab.topology.connect", annotations=LAB_WRITE, tags={"lab"})
def topology_connect(
    a: Annotated[str, Field(description="Device id or label, e.g. sw1 or SW-CORE")],
    b: Annotated[str, Field(description="Device id or label")],
) -> dict[str, Any]:
    """Cable two devices together. Assigns the next free port on each end."""
    return lab.topology_connect(a, b)


@mcp.tool(name="lab.device.list", annotations=READ, tags={"lab"})
def device_list() -> dict[str, Any]:
    """List every device in the lab with status, management IP, link count and attached systems."""
    return lab.device_list()


@mcp.tool(name="lab.device.inspect", annotations=READ, tags={"lab"})
def device_inspect(device_id: Annotated[str, Field(description="Device id or label")]) -> dict[str, Any]:
    """Full detail for one device: config, interfaces, neighbors, metrics, IPAM bindings, alerts."""
    return lab.device_inspect(device_id)


@mcp.tool(name="lab.device.run_command", annotations=LAB_WRITE, tags={"lab"})
def device_run_command(
    device_id: Annotated[str, Field(description="Device id or label")],
    command: Annotated[str, Field(description="One of: show version | show running-config | show ip interface brief | "
                                              "show cdp neighbors | ping <device> | traceroute <device> | send test-trap")],
) -> dict[str, Any]:
    """Run a CLI command on a simulated device. Read-only except `send test-trap`, which raises a
    lab verification alert in monitoring."""
    return lab.device_run_command(device_id, command)


# ------------------------------------------------------------ integrations/
@mcp.tool(name="integrations.email.list", annotations=READ, tags={"email"})
def email_list(
    folder: Literal["inbox", "sent", "all"] = "inbox",
    limit: Annotated[int, Field(ge=1, le=100)] = 20,
    unread_only: bool = False,
) -> dict[str, Any]:
    """List messages in the NOC mailbox (simulated mail system)."""
    return lab.email_list(folder, limit, unread_only)


@mcp.tool(name="integrations.email.send", annotations=WRITE, tags={"email"})
def email_send(
    to: Annotated[str, Field(description="Recipient; must be an @*.example address")],
    subject: str,
    body: str,
    confirm: Confirm = False,
) -> dict[str, Any]:
    """Send an email from the NOC mailbox. WRITE: returns a preview unless confirm=true."""
    return lab.email_send(to, subject, body, confirm)


@mcp.tool(name="integrations.meraki.get_networks", annotations=READ, tags={"meraki"})
def meraki_get_networks() -> dict[str, Any]:
    """List Meraki networks (sites) with a rolled-up status: up, degraded, down or empty.
    Use this to answer 'which sites are down?'."""
    return lab.meraki_get_networks()


@mcp.tool(name="integrations.meraki.get_devices", annotations=READ, tags={"meraki"})
def meraki_get_devices(
    network_id: Annotated[str | None, Field(description="Network id or name, e.g. N_FAKE_DOCK or Branch-Dockside")] = None,
    status: Literal["online", "offline", "alerting"] | None = None,
) -> dict[str, Any]:
    """List Meraki-managed devices (branch gear + lab nodes with Meraki attached), optionally
    filtered by network or status. Use this to find offline devices."""
    return lab.meraki_get_devices(network_id, status)


@mcp.tool(name="integrations.meraki.update_config", annotations=WRITE, tags={"meraki"})
def meraki_update_config(
    serial: Annotated[str, Field(description="Device serial from get_devices, e.g. Q2FK-LAB-SW1")],
    changes: Annotated[dict[str, Any], Field(description="Any of: name (str), access_vlan (1-4094), uplink_enabled (bool), notes (str)")],
    confirm: Confirm = False,
) -> dict[str, Any]:
    """Push a simple config change to a Meraki device. WRITE: returns before/after preview unless confirm=true."""
    return lab.meraki_update_config(serial, changes, confirm)


@mcp.tool(name="integrations.monitoring.get_alerts", annotations=READ, tags={"monitoring"})
def monitoring_get_alerts(
    severity: Literal["critical", "warning", "info"] | None = None,
    status: Literal["open", "resolved", "all"] = "open",
    site: str | None = None,
) -> dict[str, Any]:
    """List monitoring alerts (newest first), optionally filtered by severity, status, or site."""
    return lab.monitoring_get_alerts(severity, status, site)


@mcp.tool(name="integrations.monitoring.get_metrics", annotations=READ, tags={"monitoring"})
def monitoring_get_metrics(
    device: Annotated[str | None, Field(description="Device name; omit for all monitored devices")] = None,
) -> dict[str, Any]:
    """CPU, memory, latency and interface utilisation for monitored devices."""
    return lab.monitoring_get_metrics(device)


@mcp.tool(name="integrations.salesforce.query", annotations=READ, tags={"salesforce"})
def salesforce_query(
    soql: Annotated[str, Field(description="e.g. SELECT CaseNumber, Subject, Status FROM Case WHERE Status = 'Open'")],
) -> dict[str, Any]:
    """Run a small SOQL subset against the simulated Salesforce org (Case, Account)."""
    return lab.salesforce_query(soql)


@mcp.tool(name="integrations.salesforce.create_case", annotations=WRITE, tags={"salesforce"})
def salesforce_create_case(
    subject: str,
    description: str = "",
    priority: Literal["Low", "Medium", "High", "Critical"] = "Medium",
    account: Annotated[str | None, Field(description="Account Id, name, or site (e.g. Dockside)")] = None,
    device: str | None = None,
    confirm: Confirm = False,
) -> dict[str, Any]:
    """Open a support case. WRITE: returns a preview unless confirm=true."""
    return lab.salesforce_create_case(subject, description, priority, account, device, confirm)


@mcp.tool(name="integrations.ipam.get_subnets", annotations=READ, tags={"ipam"})
def ipam_get_subnets(site: str | None = None) -> dict[str, Any]:
    """List IPAM subnets with used/free counts and every allocation."""
    return lab.ipam_get_subnets(site)


@mcp.tool(name="integrations.ipam.allocate", annotations=WRITE, tags={"ipam"})
def ipam_allocate(
    subnet: Annotated[str, Field(description="Subnet id or CIDR, e.g. sn-hq-users")],
    hostname: str,
    node_id: Annotated[str | None, Field(description="Optional lab device to bind the address to")] = None,
    confirm: Confirm = False,
) -> dict[str, Any]:
    """Reserve the next free address in a subnet. WRITE: returns a preview unless confirm=true."""
    return lab.ipam_allocate(subnet, hostname, node_id, confirm)


# --------------------------------------------------- browser bridge (http only)
def build_http_app():
    """MCP over streamable HTTP at /mcp, plus a tiny /lab/* bridge so the
    canvas and this server share one lab_state. Local only (127.0.0.1)."""
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    @mcp.custom_route("/lab/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        keys = {env: mask_key(lab.env.get(env)) for env in KEY_ENV.values()}
        return JSONResponse({"ok": True, "server": "agent0067-lab", "rev": store.refresh().get("rev", 0), "keys": keys})

    @mcp.custom_route("/lab/state", methods=["GET", "PUT"])
    async def state(request: Request) -> JSONResponse:
        if request.method == "PUT":
            try:
                body = await request.json()
                st = store.replace(body)
            except (ValueError, TypeError) as exc:
                return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
            return JSONResponse({"ok": True, "rev": st["rev"]})
        return JSONResponse(store.refresh())

    @mcp.custom_route("/lab/reset", methods=["POST"])
    async def reset(_: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "rev": store.reset()["rev"]})

    local = r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
    cors = Middleware(CORSMiddleware, allow_origin_regex=local, allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                      allow_headers=["*"], expose_headers=["mcp-session-id", "mcp-protocol-version"])
    return mcp.http_app(middleware=[cors], json_response=True, stateless_http=True)


def main() -> None:
    p = argparse.ArgumentParser(description="Agent0067 lab MCP server (all data FAKE)")
    p.add_argument("--http", action="store_true", help="serve streamable HTTP on 127.0.0.1 (+ /lab bridge)")
    p.add_argument("--port", type=int, default=8067)
    a = p.parse_args()
    for system, env in KEY_ENV.items():
        print(f"[agent0067] {env:<20} {mask_key(lab.env.get(env))}", file=sys.stderr)
    if a.http:
        import uvicorn
        print(f"[agent0067] MCP endpoint  http://127.0.0.1:{a.port}/mcp", file=sys.stderr)
        uvicorn.run(build_http_app(), host="127.0.0.1", port=a.port, log_level="warning")
    else:
        mcp.run(show_banner=False)  # stdio: stdout is the protocol, logs go to stderr


if __name__ == "__main__":
    main()
