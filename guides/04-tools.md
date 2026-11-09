# Phase 4 — TOOLS: topology → device config → integrations → tools

**Carried over:** `.venv` with FastMCP, `server.py` with `lab.topology.get`, keys in `.env`.

## Procedure
1. **Topology.** Drag ROUTER, SWITCH, SERVER, FIREWALL, CLOUD and PC from the palette.
   Drag from a device's pink port dot onto another device to cable it (or turn on
   CABLE). Every canvas action *is* a tool call (`lab.topology.add_node`,
   `lab.topology.connect`), and the terminal echoes it.
2. **Device config.** Tap a device to open its console tab:
   `enable` → `conf t` → `hostname CORE-SW` → `interface Gi0/1` →
   `ip address 10.67.1.2 255.255.255.0` → `end` → `show run`.
3. **Integrations.** Double-click a device and attach systems where they belong.
4. **Tools.** Run `tool add --read-only`, then `y` (10 tools), then `tool add --writes`,
   then `y` (7 tools). Restart with `fastmcp run server.py` and `fastmcp list server.py`,
   which should show 17.

## The 17 tools
| Tool | Kind |
|---|---|
| `lab.topology.get` · `lab.device.list` · `lab.device.inspect` | read |
| `lab.topology.add_node` · `lab.topology.connect` · `lab.device.run_command` | lab write |
| `integrations.email.list` · `meraki.get_networks` · `meraki.get_devices` · `monitoring.get_alerts` · `monitoring.get_metrics` · `salesforce.query` · `ipam.get_subnets` | read |
| `integrations.email.send` · `meraki.update_config` · `salesforce.create_case` · `ipam.allocate` | **write, confirm=true** |

(The V1 brief calls this "15 tools", but its own list names 17. All 17 are built.)

## Judgment
- **Where systems attach:** Meraki goes on switches, routers and firewalls. Email lives
  on a server. Salesforce is SaaS, so it hangs off the cloud. The game refuses a bad
  attachment and explains why.
- **Read-only first.** The game refuses a system's write tool until its read tools exist.
- **Writes are previews until a human approves.** Without `confirm=true` a write returns
  `confirmation_required` and a preview. The approval belongs to the human, not the model.
- A running server keeps its old tool list until it restarts (`tools/list_changed`).
