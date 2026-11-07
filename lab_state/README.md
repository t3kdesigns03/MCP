# lab_state — the shared lab document

One JSON document that the **canvas** and the **MCP tools** both read and write.

| File | Tracked | What |
|---|---|---|
| `seed.json` | yes | The starting state: empty topology plus the five FICTIONAL systems' seed data (Neon Harbor Freight, `10.67.0.0/16`, `*.example`). Source of truth for both the browser and the Python server. |
| `state.json` | **no** (git-ignored) | Runtime state. Created from `seed.json` the first time the Python server starts. Written atomically after every mutating tool call. |

## Who writes it
- **Python server** (`mcp_server/lab.py` `LabStore`): re-reads the file whenever its mtime
  changes, so a stdio server used by an AI client and an HTTP server used by the browser
  share one state.
- **Browser game**: keeps a copy in `localStorage`. With the bridge on
  (`python mcp_server/server.py --http`, then menu › Local server bridge), every canvas
  change is `PUT` to `/lab/state` → `state.json`, and server-side changes are pulled
  back within a few seconds. **Menu › Export lab_state.json** downloads it too.
- Override the path with `AGENT0067_STATE=/some/path.json` (the tests do).

## Shape
```json
{
  "schema": 1, "rev": 12, "updated_at": "2026-11-07T21:03:03Z",
  "scenario": { "org": "Neon Harbor Freight (FICTIONAL)", "domain": "neonharbor.example" },
  "nodes": [
    { "id": "sw1", "label": "CORE-SW", "type": "switch", "x": 300, "y": 100, "status": "up",
      "integrations": ["meraki", "monitoring"], "meraki_serial": "Q2FK-LAB-SW1",
      "config": { "hostname": "CORE-SW", "mgmt_ip": "10.67.1.10", "access_vlan": 10,
                  "uplink_enabled": true, "notes": "", "config_rev": 2,
                  "interfaces": [{ "name": "Gi0/1", "peer": "rtr1", "ip": "", "status": "up" }] } }
  ],
  "edges": [{ "id": "rtr1--sw1", "a": "rtr1", "b": "sw1", "a_port": "Gi0/1", "b_port": "Gi0/1" }],
  "counters": { "...": "id sequences" },
  "integrations": {
    "email": { "mailbox": "noc@neonharbor.example", "messages": [] },
    "meraki": { "org": {}, "networks": [], "devices": [] },
    "monitoring": { "alerts": [] },
    "salesforce": { "accounts": [], "cases": [] },
    "ipam": { "subnets": [{ "id": "sn-hq-users", "cidr": "10.67.10.0/24", "allocations": [] }] }
  },
  "verification": { "ping": { "status": "pass", "detail": "PC-01 -> CORE-SW" }, "alert": {}, "case": {}, "allocate": {}, "config": {} },
  "events": []
}
```
Node types: `pc`, `switch`, `router`, `server`, `firewall`, `cloud`.
