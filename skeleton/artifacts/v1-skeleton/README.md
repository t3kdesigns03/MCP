# V1 Skeleton — Visual + Kernel Terminal POC

## What's here

- `visual/index.html` — Single-file proof of concept
  - Hackers-style dark neon canvas
  - Draggable nodes with classic-device labels (PC, Switch, Router, Server)
  - Double-click to inspect
  - Bottom terminal console

## Terminal commands (help? style)

Type any of these in the terminal area (focus the page and type):

- `help` or `?` or `help?` — command list
- `packages` or `pkg` — simulated package list (ansible, netmiko, napalm, etc.)
- `ansible-galaxy` — Galaxy info + example install lines (latest-style)
- `nodes` — list current topology nodes
- `clear` — clear terminal
- `version` — lab version

## Notes

- Icons are currently placeholder boxes + labels. Drop real Win95/98 .ico / PNG assets into `/assets` and swap the draw logic.
- Terminal is fully client-side for this skeleton. Ready to wire to a real Python MCP / kernel backend.
- All major packages mentioned are listed as available in the simulated kernel.

Open `visual/index.html` in a browser to try it.
