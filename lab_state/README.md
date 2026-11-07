# Lab State Model (V1)

Simple JSON-backed or in-memory state for the visual + MCP layers.

```json
{
  "nodes": [
    { "id": "pc1", "label": "PC-01", "type": "computer", "x": 200, "y": 150 }
  ],
  "edges": [
    ["pc1", "sw1"]
  ],
  "integrations": {
    "email": { "messages": [] },
    "meraki": { "networks": [] },
    "monitoring": { "alerts": [] },
    "salesforce": { "cases": [] },
    "ipam": { "subnets": [] }
  }
}
```

Shared by the visual canvas and the MCP tools.
