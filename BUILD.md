# CLIDK-style Lab — V1 Build Notes

Hackers-inspired visual lab with a modern guided experience, classic device icons, and an MCP-ready execution layer. Static HTML/JS skeleton ready for Netlify.

## Goal (V1)

User builds every part of the lab themselves:
- Place classic-icon nodes on a retro arcade canvas
- Connect them
- Attach simulated external systems
- Use a kernel-style terminal with full package availability
- Verify via guided walkthroughs + MCP tools

Not a full Windows 98 environment — only the device icons. Experience is modern (walkthroughs, tips, progressive disclosure) with a Hackers movie visual layer (neon, dark, CRT-adjacent).

## Simulated Execution Targets

All fake but realistic. Exposed via MCP tools:

- Email
- Meraki dashboard
- Monitoring platform (Entuity / SolarWinds style)
- Salesforce
- IPAM

## Architecture (V1)

```text
visual/          # Canvas + node rendering (classic icons)
terminal/        # Kernel console (help?, packages, ansible-galaxy)
mcp_server/      # FastMCP (or equivalent) tool surface
lab_state/       # Topology + integration state
guides/          # Walkthrough steps (Skills-style procedure + judgment)
```

### MCP Tool Hierarchy (starter)

```text
lab/
  topology.get
  topology.add_node
  topology.connect
  device.list
  device.inspect
  device.run_command

integrations/
  email.list / email.send
  meraki.get_networks / meraki.get_devices / meraki.update_config
  monitoring.get_alerts / monitoring.get_metrics
  salesforce.query / salesforce.create_case
  ipam.get_subnets / ipam.allocate
```

## Terminal Console (Kernel)

Available in the bottom console of the skeleton:

- `help` / `?` / `help?` — command list
- `packages` / `pkg` — simulated package list (ansible, netmiko, napalm, pysnmp, requests, rich, …)
- `ansible-galaxy` — latest-style Galaxy info + example install lines
- `nodes` — list current topology
- `clear` / `version`

All major packages are treated as available in the simulated kernel. Ready to wire to a real backend.

## Visual POC

Single-file skeleton: `visual/index.html`

- Dark radial background + subtle grid (Hackers-adjacent)
- Draggable nodes (PC, Switch, Router, Server) with neon outlines
- Edges between nodes
- Double-click to inspect
- Terminal console at the bottom with the commands above

Classic Win95/98-style icons can be dropped in later; placeholders are in place.

## Deployment

Netlify (static):

1. Point Netlify at the `v1-skeleton` folder (or the `visual` subfolder)
2. Publish directory: `.` or `visual`
3. No build step required for the current skeleton
4. Optional: add `_redirects` or `netlify.toml` later for clean routes

## CLIDK Comparison (what we observed)

From the Free Play Sandbox on clidk.com:

- Visual topology builder (palette + drag-to-place + drag-to-cable)
- Per-device CLI tabs
- `?` help, TAB completion, configure terminal
- Free-play or graded modes
- All in-browser, no install

Our V1 keeps the visual + terminal split but adds:
- Classic icon aesthetic
- MCP execution layer against simulated external systems
- Explicit “user builds every piece” flow
- Kernel-style package availability (including ansible-galaxy)

## Next Slices (pick one)

1. Real classic icon loading (drop PNG/ICO assets into canvas)
2. Minimal Python MCP server with the tool groups above
3. One full simulated integration (e.g. Meraki or monitoring) end-to-end
4. Guided walkthrough steps for “build your first topology”
5. Netlify deploy config + basic CI

## Files in this skeleton

- `visual/index.html` — interactive POC
- `README.md` — short pointer
- `BUILD.md` — this file

Open `visual/index.html` in a browser to try the canvas + terminal.
